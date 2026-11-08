// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
// The configured origin/prefix owns the download location; metadata cannot change it.
function metadataLocation(value) {
  const url = new URL(value);
  const match = /^(|\/market)\/skills\/bundles\/([^/]+)(?:\/versions\/([a-f0-9]{64}))?\/metadata$/.exec(url.pathname);
  if (url.username || url.password || url.search || url.hash || !match)
    throw Error('MARKET_METADATA_PATH_MISMATCH');
  return { url, prefix: match[1], service: match[2], digest: match[3] };
}

export function marketVersionMetadataUrl(source, digest) {
  const location = metadataLocation(source);
  if (!/^[a-f0-9]{64}$/.test(digest) || location.digest && location.digest !== digest)
    throw Error('MARKET_PACKAGE_VERSION_MISMATCH');
  location.url.pathname = `${location.prefix}/skills/bundles/${location.service}/versions/${digest}/metadata`;
  return location.url;
}

export function marketDownloadUrl(metadataUrl, serviceId) {
  const {url, service} = metadataLocation(metadataUrl);
  if (service !== encodeURIComponent(serviceId)) throw Error('MARKET_METADATA_PATH_MISMATCH');
  url.pathname = url.pathname.replace(/\/metadata$/, '/download');
  return url;
}
