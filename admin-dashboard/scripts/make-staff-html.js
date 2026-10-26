// Writes build/staff.html: the same app as index.html, but with the staff
// page's title, description, link-preview (Open Graph) tags and Home Screen
// manifest. Link previews (WhatsApp, SMS, Facebook) read only this static HTML,
// so without it a shared /staff link shows "GeoAttend - Admin Dashboard".
const fs = require('fs');
const path = require('path');

const SITE = 'https://geoattend-mu.vercel.app';
const TITLE = 'GeoAttend Staff Check-In';
const DESCRIPTION = 'Check in and out of work with GPS or a QR code. Sign in or sign up in one tap with Google.';

const buildDir = path.join(__dirname, '..', 'build');
let html = fs.readFileSync(path.join(buildDir, 'index.html'), 'utf8');

const replace = (pattern, value, what) => {
  if (!pattern.test(html)) throw new Error(`make-staff-html: could not find ${what} in build/index.html`);
  html = html.replace(pattern, value);
};

replace(/<title>[^<]*<\/title>/, `<title>${TITLE}</title>`, '<title>');
replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${DESCRIPTION}"/>`, 'meta description');
replace(/<link rel="manifest" href="[^"]*"\s*\/?>/, '<link rel="manifest" href="/staff-manifest.json"/>', 'manifest link');

const ogTags = [
  ['og:type', 'website'],
  ['og:site_name', 'GeoAttend'],
  ['og:title', TITLE],
  ['og:description', DESCRIPTION],
  ['og:url', `${SITE}/staff`],
  ['og:image', `${SITE}/icon-512.png`],
].map(([property, content]) => `<meta property="${property}" content="${content}"/>`).join('')
  + `<meta name="twitter:card" content="summary"/><meta name="twitter:title" content="${TITLE}"/><meta name="twitter:description" content="${DESCRIPTION}"/>`;
replace(/<\/head>/, `${ogTags}</head>`, '</head>');

fs.writeFileSync(path.join(buildDir, 'staff.html'), html);
console.log('make-staff-html: wrote build/staff.html');
