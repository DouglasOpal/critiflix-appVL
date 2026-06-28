import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';

// Fan-out a notification to many users (by role filter) or to specific ids.
export async function notifyUsers({ role, userIds, type = 'system', title, body = '', data = {} }) {
  let ids = userIds;
  if (!ids) {
    const q = role ? { role } : { role: { $ne: 'admin' } };
    ids = (await User.find(q).select('_id').lean()).map((u) => u._id);
  }
  if (!ids.length) return 0;
  const docs = ids.map((u) => ({ user: u, type, title, body, data }));
  await Notification.insertMany(docs, { ordered: false }).catch(() => {});
  return ids.length;
}

export async function notifyOne(userId, payload) {
  await Notification.create({ user: userId, ...payload });
}
