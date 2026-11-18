/** Store buttons, each shown only when its URL is configured (NEXT_PUBLIC_PLAY_STORE_URL / _APP_STORE_URL). */
export function StoreLinks({
  playUrl,
  appStoreUrl,
}: {
  playUrl: string | null;
  appStoreUrl: string | null;
}) {
  if (!playUrl && !appStoreUrl) return null;
  return (
    <div className="lp-stores">
      {playUrl ? (
        <a href={playUrl} className="lp-btn-quiet">
          Google Play
        </a>
      ) : null}
      {appStoreUrl ? (
        <a href={appStoreUrl} className="lp-btn-quiet">
          App Store
        </a>
      ) : null}
    </div>
  );
}
