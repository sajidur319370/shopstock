import { randomUUID } from 'node:crypto';
import type { Types } from 'mongoose';
import type { LoginInput } from '@shopstock/shared';
import { Session, User } from '../../db/models';
import { withTransaction } from '../../db/transaction';
import { badRequest, forbidden, unauthenticated } from '../../lib/errors';
import { randomToken, sha256 } from '../../lib/crypto';
import { addDays } from '../../lib/dates';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../../lib/password';
import { signAccessToken } from '../../lib/tokens';
import { toUserDto } from '../users/user.dto';

const REFRESH_DAYS = 7;
export interface ClientMeta {
  userAgent: string;
  ip: string;
}

export async function startSession(userId: Types.ObjectId, meta: ClientMeta) {
  const refreshToken = randomToken(32);
  const session = await Session.create({
    userId,
    familyId: randomUUID(), // a new login = a new family
    tokenHash: sha256(refreshToken),
    expiresAt: addDays(new Date(), REFRESH_DAYS),
    userAgent: meta.userAgent.slice(0, 300),
    ip: meta.ip,
  });
  return {
    accessToken: signAccessToken({ userId: String(userId), sessionId: String(session._id) }),
    refreshToken,
  };
}

export async function login(input: LoginInput, meta: ClientMeta) {
  const user = await User.findOne({ email: input.email }).select('+passwordHash').lean();
  const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw unauthenticated('INVALID_CREDENTIALS', 'Invalid email or password');
  // The password was right, so saying "disabled" reveals nothing an attacker didn't already prove.
  if (!user.isActive) throw forbidden('ACCOUNT_DISABLED', 'Your account is disabled. Ask your manager.');

  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  return { user: toUserDto(user), ...(await startSession(user._id, meta)) };
}

export async function refresh(presented: string | undefined, meta: ClientMeta) {
  if (!presented) throw unauthenticated();
  const now = new Date();
  const s = await Session.findOne({ tokenHash: sha256(presented) }).lean();
  if (!s) throw unauthenticated();

  if (s.replacedByHash || s.revokedAt) {
    // A rotated or revoked token came back: assume theft and kill the whole family.
    await Session.updateMany({ familyId: s.familyId, revokedAt: null }, { $set: { revokedAt: now } });
    throw unauthenticated('SESSION_REVOKED', 'Please log in again.');
  }
  if (s.expiresAt <= now) throw unauthenticated('TOKEN_EXPIRED', 'Please log in again.');
  if (!(await User.exists({ _id: s.userId, isActive: true }))) {
    throw unauthenticated('ACCOUNT_DISABLED', 'Your account is disabled.');
  }

  const next = randomToken(32);
  const created = await withTransaction(async (session) => {
    // CAS: only one concurrent refresh can claim this token.
    const claimed = await Session.findOneAndUpdate(
      { _id: s._id, replacedByHash: null, revokedAt: null },
      { $set: { replacedByHash: sha256(next) } },
      { session },
    );
    if (!claimed) throw unauthenticated('SESSION_REVOKED', 'Please log in again.');
    const [doc] = await Session.create(
      [
        {
          userId: s.userId,
          familyId: s.familyId,
          tokenHash: sha256(next),
          expiresAt: addDays(now, REFRESH_DAYS),
          userAgent: meta.userAgent.slice(0, 300),
          ip: meta.ip,
        },
      ],
      { session },
    );
    return doc!;
  }, 'refresh');

  return {
    refreshToken: next,
    accessToken: signAccessToken({ userId: String(s.userId), sessionId: String(created._id) }),
  };
}

export async function logout(presented: string | undefined) {
  if (!presented) return;
  const s = await Session.findOne({ tokenHash: sha256(presented) })
    .select('familyId')
    .lean();
  if (s)
    await Session.updateMany({ familyId: s.familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

export async function revokeAllSessions(userId: Types.ObjectId) {
  await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

export async function changePassword(
  userId: Types.ObjectId,
  sessionId: string,
  current: string,
  next: string,
) {
  const user = await User.findById(userId).select('+passwordHash').lean(); // users aren't branch-guarded
  if (!user || !(await verifyPassword(current, user.passwordHash))) {
    throw badRequest('WRONG_PASSWORD', 'Your current password is incorrect.');
  }
  if (current === next) throw badRequest('SAME_PASSWORD', 'Choose a different password.');
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        passwordHash: await hashPassword(next),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    },
  );
  // Revoke every OTHER login (FR-AUTH-13); keep the current family alive.
  const mine = await Session.findById(sessionId).select('familyId').lean();
  await Session.updateMany(
    { userId, revokedAt: null, ...(mine && { familyId: { $ne: mine.familyId } }) },
    { $set: { revokedAt: new Date() } },
  );
}
