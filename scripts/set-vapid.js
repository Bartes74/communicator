// Generate VAPID keys and write/update them in .env
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
const envPath = path.join(process.cwd(), '.env');
let content = '';
try {
  content = fs.readFileSync(envPath, 'utf8');
} catch {
  content = '';
}

function upsert(lineKey, value) {
  const regex = new RegExp(`^${lineKey}=.*`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${lineKey}=${value}`);
  } else {
    if (content.length && !content.endsWith('\n')) content += '\n';
    content += `${lineKey}=${value}\n`;
  }
}

upsert('VAPID_PUBLIC_KEY', publicKey);
upsert('VAPID_PRIVATE_KEY', privateKey);
if (!/^VAPID_SUBJECT=.*/m.test(content)) {
  upsert('VAPID_SUBJECT', 'mailto:admin@example.com');
}

fs.writeFileSync(envPath, content, 'utf8');
console.log('VAPID keys written to .env');


