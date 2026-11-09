/**
 * Ortak maden satırı, ancak işçi hâlâ o channel'ın etkin üyesiyse ve
 * krallık kaydı başka bir channel'a taşınmamışsa geçerlidir. Kapasite hesabı
 * bunu kullanmazsa, channel değiştiren eski işçiler görünmeden bütün maden
 * yuvalarını tutabilir.
 */
export function isCurrentMineCrew(input: {
  activeMembership: boolean;
  mineChannelId: string;
  game: { channelId?: string } | null;
}) {
  if (!input.activeMembership || !input.game) return false;
  // Eski, channelId taşımayan geçerli kayıtları ilk yüklemede işsiz bırakma.
  return !input.game.channelId || input.game.channelId === input.mineChannelId;
}
