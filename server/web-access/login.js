document.querySelector("#toggle-password")?.addEventListener("click", event => {
  const input = document.querySelector("#password");
  const visible = input.type === "password";
  input.type = visible ? "text" : "password";
  event.currentTarget.textContent = visible ? "隐藏" : "显示";
  event.currentTarget.setAttribute("aria-label", visible ? "隐藏密码" : "显示密码");
  event.currentTarget.setAttribute("aria-pressed", String(visible));
});

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
