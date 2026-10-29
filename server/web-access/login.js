document.querySelector("#toggle-password")?.addEventListener("click", event => {
  const input = document.querySelector("#password");
  const visible = input.type === "password";
  input.type = visible ? "text" : "password";
  event.currentTarget.textContent = visible ? "隐藏" : "显示";
  event.currentTarget.setAttribute("aria-label", visible ? "隐藏密码" : "显示密码");
  event.currentTarget.setAttribute("aria-pressed", String(visible));
});

document.querySelector("#recovery-mode")?.addEventListener("change", event => {
  const recovery = event.currentTarget.checked;
  const input = document.querySelector("#code");
  input.inputMode = recovery ? "text" : "numeric";
  input.placeholder = recovery ? "输入一条恢复码" : "输入 6 位动态码";
  document.querySelector("#code-label").textContent = recovery ? "一次性恢复码" : "Google Authenticator 验证码";
});
for (const [buttonId, sourceId] of [["copy-setup-key", "setup-key"], ["copy-recovery-codes", "recovery-codes"]]) {
  document.querySelector(`#${buttonId}`)?.addEventListener("click", async event => {
    const button = event.currentTarget;
    try {
      const source = document.querySelector(`#${sourceId}`);
      await navigator.clipboard.writeText(source.value || source.textContent);
      button.textContent = "已复制";
    } catch { button.textContent = "请长按上方内容复制"; }
  });
}

// Office controls can mount after hydration or SPA navigation.
document.addEventListener("click", async event => {
  const button = event.target instanceof Element ? event.target.closest("[data-logout]") : null;
  if (!button || button.disabled) return;
  button.disabled = true;
  try {
    const response = await fetch("/auth/session");
    if (response.status !== 401) {
      if (!response.ok) throw new Error("Session unavailable");
      const { csrf } = await response.json();
      const result = await fetch("/auth/logout", { method: "POST", body: new URLSearchParams({ csrf }) });
      if (!result.ok) throw new Error("Logout failed");
    }
    location.assign("/login");
  } catch {
    button.disabled = false;
    button.textContent = "退出失败，点此重试";
  }
});
