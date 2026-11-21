import { startOpenAiMock } from './openai-mock';

/** Starts the OpenAI mock for the AI designer specs; the returned function stops it after the run. */
export default async function globalSetup() {
  const stop = await startOpenAiMock();
  return stop;
}
