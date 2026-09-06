import {
  authenticatedUser,
  requireSameOrigin,
  readJSON,
  json,
  fail,
  ApiError,
} from '@/server/runtime';
import { getTraining, savePlan, saveWorkout } from '@/server/training';
import { validDay } from '@/lib/health';
import { object } from '@/lib/connections';
export async function GET(request: Request) {
  try {
    const user = authenticatedUser(request);
    const day =
      new URL(request.url).searchParams.get('day') ||
      new Date().toISOString().slice(0, 10);
    if (!validDay(day)) throw new ApiError('Choose a valid day.');
    return json(await getTraining(user, day));
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request) {
  try {
    const user = authenticatedUser(request);
    requireSameOrigin(request);
    const body = object(await readJSON(request));
    if (body.action === 'plan')
      return json({ preferences: await savePlan(user, body.preferences) });
    if (body.action === 'workout')
      return json({ workout: await saveWorkout(user, body.workout) });
    throw new ApiError('Choose a valid training action.');
  } catch (error) {
    return fail(error);
  }
}
