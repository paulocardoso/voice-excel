import { accessToken } from './auth';

const assessmentApiUrl = process.env.EXPO_PUBLIC_ASSESSMENT_API_URL?.replace(/\/$/, '');

export async function deleteRemoteAccount(): Promise<void> {
  if (!assessmentApiUrl) return;
  const token = await accessToken();
  if (!token) throw new Error('Please sign in before deleting your cloud account.');
  const response = await fetch(`${assessmentApiUrl}/v1/account`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('We could not delete your cloud account. Please try again.');
}
