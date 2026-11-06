// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
const form = document.querySelector("#form"),
  button = document.querySelector("#submit"),
  error = document.querySelector("#error");
fetch("/context")
  .then((r) => {
    if (!r.ok) throw Error();
    return r.json();
  })
  .then((data) => {
    document.querySelector("#context").textContent = JSON.stringify(
      data,
      null,
      2,
    );
    button.disabled = false;
  })
  .catch(() => {
    error.textContent = "读取失败，请从终端显示的本机地址重新打开页面。";
  });
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  error.textContent = "";
  document.querySelector("#result").hidden = true;
  try {
    const data = Object.fromEntries(new FormData(form));
    data.validUntilMs = new Date(data.validUntil).getTime();
    delete data.validUntil;
    const response = await fetch("/preview", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agentpay-preview": "1",
      },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    document.querySelector("#summary").textContent = JSON.stringify(
      {
        授权草案: result.draft,
        链上核对: result.chainState || "未完成",
        提示:
          result.chainError ||
          (result.chainState?.demo
            ? "界面演示，未核对链上状态"
            : "只读核对完成；尚未签名或绑定"),
      },
      (key, value) => (key === "calls" ? undefined : value),
      2,
    );
    document.querySelector("#calls").textContent = JSON.stringify(
      result.draft.calls,
      null,
      2,
    );
    document.querySelector("#result").hidden = false;
  } catch (e) {
    error.textContent = e.message || "预览失败，请检查输入后重试。";
  } finally {
    button.disabled = false;
  }
});
