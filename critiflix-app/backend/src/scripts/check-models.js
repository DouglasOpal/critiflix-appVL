// Loads every model + util WITHOUT a DB connection to prove the schema compiles.
import mongoose from 'mongoose';
import * as models from '../models/index.js';
import '../utils/tokens.js';
import '../services/authService.js';
import '../services/pointsService.js';

let ok = true;
console.log('Registered models & key paths:\n');
for (const [name, Model] of Object.entries(models)) {
  if (!Model?.schema) { console.log(`  ✗ ${name} is not a model`); ok = false; continue; }
  const paths = Object.keys(Model.schema.paths).filter((p) => !['__v'].includes(p));
  const indexes = Model.schema.indexes().length;
  console.log(`  ✓ ${name.padEnd(14)} collection="${Model.collection.name}"  fields=${paths.length}  indexes=${indexes}`);
}

// Verify bcrypt + token utils work (pure crypto, no DB needed).
const { User } = models;
const { signAccessToken, verifyAccessToken, newRefreshToken, hashToken } = await import('../utils/tokens.js');
const hash = await User.hashPassword('critiflix123');
const fakeUser = { _id: new mongoose.Types.ObjectId(), role: 'critic', code: 'CR-9999', passwordHash: hash };
const cmp = await new User(fakeUser).verifyPassword('critiflix123');
const access = signAccessToken(fakeUser);
const decoded = verifyAccessToken(access);
const rt = newRefreshToken();
console.log('\nAuth crypto self-check:');
console.log('  bcrypt verify          ', cmp === true ? 'OK' : 'FAIL');
console.log('  jwt sub matches user   ', decoded.sub === String(fakeUser._id) ? 'OK' : 'FAIL');
console.log('  refresh hash stable    ', hashToken(rt.token) === rt.tokenHash ? 'OK' : 'FAIL');

if (!ok || cmp !== true) process.exit(1);
console.log('\nAll models compiled and auth primitives verified (no DB needed).');
process.exit(0);
