// Date + pace formatting helpers - TODO: implement
export const formatDate = (date: Date): string => {
  return date.toLocaleDateString();
};

export const formatPace = (pace: number): string => {
  const minutes = Math.floor(pace);
  const seconds = Math.round((pace - minutes) * 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};