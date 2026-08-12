// src/browser.js — Playwright controller for model-specific adapters
'use strict';

const { chromium } = require('playwright');
const path         = require('path');
const config       = require('./config');
const logger       = require('./logger');
const { Errors }   = require('./errors');
const { getAdapter, getModelUrl } = require('./adapter-factory');
const { runHealthCheckWithReAuth } = require('./health');

// ────────────────────────────────────────────────────────────────
//  DeepSeekBrowser class
// ────────────────────────────────────────────────────────────────

class DeepSeekBrowser {
  constructor() {
    this.context  = null;
    this.page     = null;
    this._closed  = false;
    this.adapter  = null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  async launch() {
    logger.info(`Launching browser for ${config.MODEL} with persistent session...`);

    const sessionDir = path.resolve(config.SESSION_DIR);

    this.context = await chromium.launchPersistentContext(sessionDir, {
      headless      : config.HEADLESS,
      viewport      : { width: 1280, height: 900 },
      userAgent     : [
        'Mozilla/5.0 (X11; Linux x86_64)',
        'AppleWebKit/537.36 (KHTML, like Gecko)',
        'Chrome/124.0.0.0 Safari/537.36',
      ].join(' '),
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--disable-default-apps',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });

    // Grab existing page or open a new one
    const pages   = this.context.pages();
    this.page     = pages.length > 0 ? pages[0] : await this.context.newPage();

    // Mask automation signals
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // Initialize model adapter
    this.adapter = getAdapter(config.MODEL, this.page, config);

    await this._navigate(getModelUrl(config.MODEL));

    // Run full session health check — handles login re-auth automatically
    await runHealthCheckWithReAuth(this.page, this.adapter, config, async () => {
      // Try automated login when credentials are configured
      const email = config.DEEPSEEK_EMAIL || process.env.DEEPSEEK_EMAIL || '';
      const password = config.DEEPSEEK_PASSWORD || process.env.DEEPSEEK_PASSWORD || '';

      if (email && password) {
        try {
          const ok = await this._autoLogin(email, password);
          if (ok) return; // login succeeded, health check will re-run
        } catch (e) {
          logger.warn('Auto-login attempt threw: ' + (e && e.message ? e.message : String(e)));
        }
      }

      // Fall back to interactive prompt
      this._printLoginBanner();
      await this._waitForEnter();
    });

    logger.success('Browser ready!');
  }

  async close() {
    if (this._closed) return;
    this._closed = true;
    try { await this.context?.close(); } catch {}
  }

  // ── Navigation ──────────────────────────────────────────────────────────

  async _navigate(url) {
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.BROWSER_TIMEOUT || 90_000 });
      await this.page.waitForTimeout(3_000);
    } catch (err) {
      logger.warn(`Navigation warning: ${err.message}`);
    }
  }

  async newChat() {
    if (!this.adapter) throw new Error('Browser not initialized');
    return await this.adapter.newChat();
  }

  // ── Login handling ────────────────────────────────────────────────────────

  /**
   * Attempt automated login when credentials are provided.
   * Returns true if login succeeded (or at least the page looks logged-in),
   * false otherwise.
   */
  async _autoLogin(email, password) {
    try {
      if (!email || !password) return false;

      logger.dim('Attempting automated DeepSeek login using configured credentials');

      // Common selectors to try for email/password fields and submit button
      const emailSelectors = [
        'input[type="email"]',
        'input[name="email"]',
        'input[placeholder*="email" i]',
        'input[placeholder*="Email" i]'
      ];
      const passwordSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        'input[placeholder*="password" i]'
      ];
      const submitSelectors = [
        'button[type="submit"]',
        'button:has-text("Sign in")',
        'button:has-text("Sign In")',
        'button:has-text("Log in")',
        'button:has-text("Log In")',
        'button:has-text("Continue")'
      ];

      // Ensure we're on the model URL
      try {
        const url = this.page.url();
        if (!url.includes('login') && !url.includes('signin')) {
          await this.page.goto(config.DEEPSEEK_URL || 'https://chat.deepseek.com', { waitUntil: 'domcontentloaded', timeout: config.BROWSER_TIMEOUT || 30000 });
          await this.page.waitForTimeout(1000);
        }
      } catch {}

      // Helper to try filling and submitting the form
      const tryFill = async () => {
        let emailEl = null;
        for (const sel of emailSelectors) {
          try { const el = await this.page.$(sel); if (el) { emailEl = el; break; } } catch {}
        }

        let passwordEl = null;
        for (const sel of passwordSelectors) {
          try { const el = await this.page.$(sel); if (el) { passwordEl = el; break; } } catch {}
        }

        // If neither input is found, try clicking common sign-in triggers to reveal a form
        if (!emailEl && !passwordEl) {
          for (const sel of submitSelectors) {
            try {
              const el = await this.page.$(sel);
              if (el && await el.isVisible()) {
                await el.click();
                await this.page.waitForTimeout(800);
                break;
              }
            } catch {}
          }
        }

        // Re-query after reveal
        if (!emailEl) {
          for (const sel of emailSelectors) {
            try { const el = await this.page.$(sel); if (el) { emailEl = el; break; } } catch {}
          }
        }
        if (!passwordEl) {
          for (const sel of passwordSelectors) {
            try { const el = await this.page.$(sel); if (el) { passwordEl = el; break; } } catch {}
          }
        }

        if (emailEl) {
          try { await emailEl.click({ force: true }); await this.page.waitForTimeout(100); await emailEl.fill(email); } catch {}
        }
        if (passwordEl) {
          try { await passwordEl.click({ force: true }); await this.page.waitForTimeout(100); await passwordEl.fill(password); } catch {}
        }

        for (const sel of submitSelectors) {
          try {
            const btn = await this.page.$(sel);
            if (btn && await btn.isVisible()) { await btn.click(); return true; }
          } catch {}
        }

        // Last resort: press Enter in password field
        try { if (passwordEl) { await passwordEl.press('Enter'); return true; } } catch {}

        return false;
      };

      // Try a few times, waiting for either navigation or chat input to appear
      const maxAttempts = 3;
      for (let i = 0; i < maxAttempts; i++) {
        await tryFill();
        await this.page.waitForTimeout(1500 + i * 500);

        // Check if chat input visible
        try {
          const chatInputSelectors = this.adapter && this.adapter._getInputSelectors ? this.adapter._getInputSelectors() : ['textarea', 'div[contenteditable="true"]'];
          for (const sel of chatInputSelectors.slice(0, 3)) {
            try {
              const el = await this.page.$(sel);
              if (el && await el.isVisible()) {
                logger.dim('Automated login appears successful (chat input visible)');
                return true;
              }
            } catch {}
          }
        } catch {}

        const nowUrl = this.page.url();
        if (!nowUrl.includes('login') && !nowUrl.includes('signin') && nowUrl !== (config.DEEPSEEK_URL || 'https://chat.deepseek.com')) {
          logger.dim(`Automated login appears to have navigated to ${nowUrl}`);
          return true;
        }
      }

      logger.warn('Automated DeepSeek login did not succeed (selectors may have changed)');
      return false;
    } catch (err) {
      logger.warn('Automated DeepSeek login failed: ' + (err && err.message ? err.message : String(err)));
      return false;
    }
  }

  _printLoginBanner() {
    console.log('');
    logger.warn('╔══════════════════════════════════════════════╗');
    logger.warn('║  🔐  LOGIN REQUIRED                          ║');
    logger.warn('║                                              ║');
    logger.warn(`║  1. Log in to ${config.MODEL} in the browser    ║`);
    logger.warn('║  2. Return here and press  ENTER  to continue║');
    logger.warn('╚══════════════════════════════════════════════╝');
    console.log('');
  }

  async _waitForEnter() {
    return new Promise(resolve => {
      const stdin   = process.stdin;
      const wasRaw  = stdin.isRaw;
      const wasPaused = !stdin.readable;

      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.resume();

      const handler = chunk => {
        const s = chunk.toString();
        if (s.includes('\n') || s.includes('\r')) {
          stdin.removeListener('data', handler);
          if (stdin.isTTY && wasRaw) stdin.setRawMode(true);
          if (wasPaused)            stdin.pause();
          resolve();
        }
      };

      stdin.on('data', handler);
    });
  }

  // ── Sending Messages ───────────────────────────────────────────────────────

  async sendMessage(text) {
    if (!this.adapter) throw new Error('Browser not initialized');
    
    try {
      return await this.adapter.sendMessage(text);
    } catch (firstErr) {
      const msg = firstErr.message.toLowerCase();
      // If it looks like a selector error or timeout, wait and retry once
      if (msg.includes('not found') || msg.includes('selector') || msg.includes('timeout')) {
        logger.warn('Send failed — waiting 3s and retrying...');
        await this.page.waitForTimeout(3000);
        
        try {
          return await this.adapter.sendMessage(text);
        } catch (secondErr) {
          // Take debug screenshot on final failure
          try {
            const debugPath = '/tmp/forge-selector-debug.png';
            await this.page.screenshot({ path: debugPath });
            logger.dim(`Debug screenshot saved: ${debugPath}`);
          } catch (e) {}
          throw secondErr;
        }
      }
      throw firstErr;
    }
  }

  // ── Waiting for Response ───────────────────────────────────────────────────

  async waitForResponse() {
    if (!this.adapter) throw new Error('Browser not initialized');
    return await this.adapter.waitForResponse();
  }

  // ── Debug / Calibration Utilities ─────────────────────────────────────────

  /**
   * Dump useful DOM information to stdout.
   */
  async dumpDebugInfo() {
    const info = await this.page.evaluate(() => {
      const classFreq = {};
      document.querySelectorAll('*').forEach(el => {
        el.classList.forEach(c => {
          if (c.match(/message|chat|input|send|stop|markdown|content|assistant|user|bot/i)) {
            classFreq[c] = (classFreq[c] || 0) + 1;
          }
        });
      });

      const inputs = Array.from(document.querySelectorAll('textarea, [contenteditable]')).map(e => ({
        tag         : e.tagName,
        id          : e.id || null,
        class       : e.className?.slice(0, 80) || null,
        placeholder : e.placeholder || null,
        editable    : e.isContentEditable,
        visible     : e.offsetParent !== null,
      }));

      return {
        url    : window.location.href,
        title  : document.title,
        classes: Object.entries(classFreq).sort((a, b) => b[1] - a[1]).slice(0, 40),
        inputs,
      };
    });

    console.log('\n' + '═'.repeat(60));
    console.log('  DOM DEBUG INFO');
    console.log('═'.repeat(60));
    console.log('URL   :', info.url);
    console.log('Title :', info.title);
    console.log('\nInput elements:');
    info.inputs.forEach(i => console.log(' ', JSON.stringify(i)));
    console.log('\nMatching CSS classes (by frequency):');
    info.classes.forEach(([cls, count]) => console.log(`  ${String(count).padStart(3)}x  .${cls}`));
    console.log('═'.repeat(60) + '\n');
  }

  /** Take a screenshot (for debugging) */
  async screenshot(filePath = '/tmp/forge-agent-debug.png') {
    await this.page.screenshot({ path: filePath, fullPage: false });
    logger.info(`Screenshot saved: ${filePath}`);
  }
}

module.exports = DeepSeekBrowser;
