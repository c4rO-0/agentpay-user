// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
// Preserve the approved metadata URL's ingress prefix; metadata cannot select a host.
export function marketDownloadUrl(metadataUrl, serviceId) {
  const url = new URL(metadataUrl);
  const suffix = `/skills/bundles/${encodeURIComponent(serviceId)}/metadata`;
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith(suffix)
  )
    throw Error("MARKET_METADATA_PATH_MISMATCH");
  const prefix = url.pathname.slice(0, -suffix.length);
  if (!["", "/market"].includes(prefix))
    throw Error("MARKET_METADATA_PREFIX_INVALID");
  url.pathname = prefix + suffix.replace(/\/metadata$/, "/download");
  return url;
}
