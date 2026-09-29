require('dotenv').config();
const fs=require('fs');
const path=require('path');
const {MongoClient}=require('mongodb');
(async()=>{
  const uri=process.env.MONGODB_URI;
  const dbName=process.env.MONGODB_DB||'hiretrust';
  if(!uri){console.error('Set MONGODB_URI in .env first.');process.exit(1);}
  const file=path.join(__dirname,'database.json');
  if(!fs.existsSync(file)){console.error('database.json was not found. Nothing to migrate.');process.exit(1);}
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  const client=new MongoClient(uri);
  try{
    await client.connect();
    const col=client.db(dbName).collection('hiretrust_state');
    await col.replaceOne({_id:'state'},{_id:'state',users:data.users||[],sessions:data.sessions||[]},{upsert:true});
    console.log(`Migrated ${(data.users||[]).length} users and ${(data.sessions||[]).length} sessions to MongoDB database "${dbName}".`);
    console.log('After verifying the data in MongoDB, you can remove database.json.');
  }finally{await client.close();}
})().catch(e=>{console.error('Migration failed:',e.message);process.exit(1);});
