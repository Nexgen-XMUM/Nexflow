const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dictionary = fs.readFileSync(path.join(__dirname, '../i18n.js'), 'utf8');
const moduleSource = dictionary.slice(dictionary.indexOf('(function welcomeLocale()'));
const html = fs.readFileSync(path.join(__dirname, '../welcome_page.html'), 'utf8');

function page(saved, blockedStorage = false) {
  const storage = new Map(saved ? [['orbyte_welcome_language', saved]] : []);
  const handlers = {};
  const picker = {value:'en', addEventListener:(name, fn) => { handlers[name] = fn; }};
  const text = (value, excluded = false) => ({
    nodeValue:value,
    parentElement:{closest:() => excluded}
  });
  const heading = text('Give the day’s last bread');
  const ending = text('a better ending.');
  const dynamic = text('Scanning…');
  const user = text('Our purpose', true);
  const nodes = [heading, ending, dynamic, user];
  const input = {
    values:{placeholder:'Ask Crumb…', 'aria-label':'Ask Crumb a question'},
    closest:() => false,
    hasAttribute(name) { return Object.hasOwn(this.values, name); },
    getAttribute(name) { return this.values[name]; },
    setAttribute(name, value) { this.values[name] = value; }
  };
  let observerCallback;
  const document = {
    body:{}, documentElement:{dataset:{}, lang:'en'},
    getElementById:() => picker,
    querySelectorAll:() => [input],
    createTreeWalker() {
      let index = 0;
      return {nextNode:() => nodes[index++] || null};
    }
  };
  const context = {
    document, window:{}, NodeFilter:{SHOW_TEXT:4},
    localStorage:{
      getItem(key) { if (blockedStorage) throw new Error('disabled'); return storage.get(key); },
      setItem(key, value) { if (blockedStorage) throw new Error('disabled'); storage.set(key, value); }
    },
    MutationObserver:class {
      constructor(callback) { observerCallback = callback; }
      disconnect() {}
      observe() {}
    },
    requestAnimationFrame(fn) { setImmediate(fn); return 1; }
  };
  vm.runInNewContext(moduleSource, context);
  return {
    api:context.window.NexgenWelcomeLocale, document, picker, storage,
    heading, ending, dynamic, user, input,
    change(value) { picker.value = value; handlers.change(); },
    mutate(value) { dynamic.nodeValue = value; observerCallback(); }
  };
}

test('first visit defaults to English, without using browser language', () => {
  const p = page();
  assert.equal(p.api.language, 'en');
  assert.equal(p.heading.nodeValue, 'Give the day’s last bread');
  assert.equal(p.document.documentElement.lang, 'en');
  assert.equal(p.storage.size, 0);
});

test('switches English → Chinese → Malay → English without losing source text', () => {
  const p = page();
  p.change('zh-CN');
  assert.equal(p.ending.nodeValue, '拥有更好的归宿。');
  assert.equal(p.input.values.placeholder, '问问 Crumb…');
  assert.equal(p.document.documentElement.lang, 'zh-CN');
  assert.equal(p.storage.get('orbyte_welcome_language'), 'zh-CN');
  assert.equal(p.user.nodeValue, 'Our purpose');
  p.change('ms');
  assert.equal(p.ending.nodeValue, 'pengakhiran yang lebih baik.');
  assert.equal(p.input.values.placeholder, 'Tanya Crumb…');
  p.change('en');
  assert.equal(p.heading.nodeValue, 'Give the day’s last bread');
  assert.equal(p.ending.nodeValue, 'a better ending.');
  assert.equal(p.input.values.placeholder, 'Ask Crumb…');
});

test('honors an explicit saved choice and still works when storage is disabled', () => {
  assert.equal(page('ms').api.language, 'ms');
  assert.equal(page('invalid').api.language, 'en');
  const p = page(undefined, true);
  assert.equal(p.api.language, 'en');
  p.change('zh-CN');
  assert.equal(p.api.language, 'zh-CN');
});

test('localizes new scan feedback and restores it when returning to English', async () => {
  const p = page('ms');
  p.mutate('Confirmed 8 items — added to Recent confirmations on this page only.');
  await new Promise(setImmediate);
  assert.match(p.dynamic.nodeValue, /8 item disahkan/);
  assert.match(p.dynamic.nodeValue, /halaman ini sahaja/);
  p.change('en');
  assert.equal(p.dynamic.nodeValue, 'Confirmed 8 items — added to Recent confirmations on this page only.');
  assert.equal(p.api.translate('RM 180.00', 'zh-CN'), 'RM 180.00');
  assert.equal(p.api.translate('croissant', 'ms'), 'croissant');
  assert.equal(p.api.translate('8 boxes', 'zh-CN'), '8 个识别框');
});

test('both locales cover every static welcome paragraph and navigation label', () => {
  const p = page();
  const markup = html.replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, '');
  const text = markup.replace(/<[^>]*>/g, '\0').split('\0')
    .map(s => s.trim().replace(/&amp;/g, '&')).filter(s => /[a-z]{3}/i.test(s));
  const identifiers = new Set([
    'Orbyte Smart Yield', 'Orbyte Smart Yield · Nexgen', 'NEXGEN',
    'RM 180.00', 'Uncle Wong', 'Auntie Lim', 'Farid', 'English', 'Bahasa Melayu'
  ]);
  for (const source of text.filter(s => !identifiers.has(s))) {
    for (const locale of ['zh-CN','ms']) {
      assert.notEqual(p.api.translate(source, locale), source, `${locale} missing: ${source}`);
    }
  }
});

test('welcome header has a top-left sign-in link to the login page, translated', () => {
  const header = html.slice(html.indexOf('<header class="top wrap">'));
  assert.match(header.slice(0, 200), /<a class="signin-link" href="\/login"[^>]*>Sign in<\/a>/);
  const p = page();
  assert.equal(p.api.translate('Sign in', 'zh-CN'), '登录');
  assert.equal(p.api.translate('Sign in', 'ms'), 'Log masuk');
});

test('frontend api helpers turn network failures into a readable offline message', () => {
  for (const file of ['../index.html', '../customer.js']) {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.match(src, /common\.offline/, file);
  }
});
