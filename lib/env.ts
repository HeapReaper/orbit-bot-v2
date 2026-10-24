export const getEnv = (key: string, fallback: string = ''): string => {
  const envValue = process.env[key];

  return envValue ? envValue : fallback;
};
