import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const source = new URL('../../public/', import.meta.url);
const output = new URL('./dist/', import.meta.url);
await mkdir(output, { recursive: true });
const files = ['index.html', 'privacy.html', 'results.html', 'book.html', 'thank-you.html', 'styles.css', 'hero-brand.css', 'site-brand.css', 'attribution.js', 'inline-flow.js', 'results.js', 'book.js', 'favicon.svg', 'favicon-32.png', 'favicon-16.png', 'apple-touch-icon.png', 'og-image.png', 'logos', 'wins', 'photos', 'proof', 'videos/breakouts', 'assets/confirmation-faq', 'assets/brand', 'assets/rankboost-vsl-page-one.be53caf8850c.webp'];
for (const file of files) {
  const target = new URL(file, output);
  await mkdir(fileURLToPath(new URL('./', target)), { recursive: true });
  await cp(new URL(file, source), target, { recursive: true, filter: path => !path.endsWith('.mp4') });
}
// Preview-only changes never enter public/ or the production Pages bundle.
for (const file of ['index.html', 'privacy.html', 'results.html', 'book.html', 'thank-you.html']) {
  let html = await readFile(new URL(file, output), 'utf8');
  html = html.replace(/<head>/, '<head><script src="/preview-guard.js"></script>');
  html = html.replace(/<wistia-player\b/g, '<wistia-player do-not-track');
  html = html.replace('poster="https://threestripesdigital.com/rank-boost/law-firms/assets/rankboost-vsl-page-one.be53caf8850c.webp"', 'poster="https://rankboost-hero-brand-preview.bilal-17f.workers.dev/assets/rankboost-vsl-page-one.be53caf8850c.webp"');
  html = html.replace(/name="robots" content="[^"]*"/, 'name="robots" content="noindex,nofollow,noarchive"');
  await writeFile(new URL(file, output), html);
}
for (const file of ['meta.js', 'replay.js', 'analytics.js']) {
  await writeFile(new URL(file, output), '/* Isolated design preview: production analytics disabled. */\nwindow.tsdMetaTrackingEnabled = false;\n');
}
await writeFile(new URL('preview-guard.js', output), `
window.tsdMetaTrackingEnabled = false;
document.addEventListener('submit', function(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.target.id !== 'qualify-form') return;
  var note = document.getElementById('preview-submit-note');
  if (!note) {
    note = document.createElement('p');
    note.id = 'preview-submit-note';
    note.setAttribute('role', 'status');
    note.style.cssText = 'color:#FAF8F2;padding:16px 0;margin:0;font-size:14px;line-height:1.5';
    event.target.append(note);
  }
  note.textContent = 'Design preview only. Your details have not been sent and no appointment has been booked.';
}, true);
`);
console.log('Built isolated hero preview. No production bindings or submit endpoints.');
