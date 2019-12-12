const R_ASSET_URL = /^asset:\/\/(.+)$/;
const R_LEGACY_ASSET_URL = /^\/[^\/].+/;
export function getB2AssetAbsoluteURL(base: string, assetURL: string) {
  if (!base) {
    return null;
  }
  const matches = R_ASSET_URL.exec(assetURL);
  if (matches) {
    return base + "/" + matches[1];
  } else {
    if (R_LEGACY_ASSET_URL.test(assetURL)) {
      return base + assetURL;
    } else {
      return assetURL;
    }
  }
}
