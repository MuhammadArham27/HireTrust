require('dotenv').config();

const { MongoClient } = require('mongodb');

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'hiretrust';

  if (!uri) {
    throw new Error('MONGODB_URI is missing from .env');
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();

    const collection = client
      .db(dbName)
      .collection('hiretrust_state');

    const doc = await collection.findOne({ _id: 'state' });

    if (!doc || !Array.isArray(doc.users)) {
      throw new Error('HireTrust user data was not found.');
    }

    const email = 'junjkook.1227@gmail.com';

    const user = doc.users.find(
      u => String(u.email || '').toLowerCase() === email.toLowerCase()
    );

    if (!user) {
      throw new Error(`No account found for ${email}`);
    }

    user.twoFactorEnabled = false;
    user.securityUpdatedAt = new Date().toISOString();

    await collection.replaceOne(
      { _id: 'state' },
      doc,
      { upsert: true }
    );

    console.log('');
    console.log('SUCCESS');
    console.log(`2FA disabled for: ${user.email}`);
    console.log(`User ID: ${user.userId}`);
    console.log('');
    console.log('You can now log in normally.');
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error('');
  console.error('FAILED:', error.message);
  process.exit(1);
});