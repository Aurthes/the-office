const QRCode = require("qrcode");
const escape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const errorBox = error => error ? `<div class="error" role="alert">${escape(error)}</div>` : "";
const csrfInput = csrf => `<input type="hidden" name="csrf" value="${escape(csrf)}">`;

function loginView({ username, csrf, enabled, required, error }) {
  return `<span class="welcome-tag">欢迎回来</span><h1 id="login-title">登录你的办公室</h1>
    <p class="intro">${enabled ? "输入密码和验证器动态码，继续手上的事。" : required ? "先输入密码，下一步绑定 Google Authenticator。" : "使用你的用户名和密码，继续手上的事。"}</p>
    ${errorBox(error)}<form action="/auth/login" method="post">${csrfInput(csrf)}
    <label for="username">用户名</label><input id="username" name="username" autocomplete="username" value="${escape(username)}" required maxlength="120" spellcheck="false" autocapitalize="none">
    <label for="password">密码</label><div class="password-field"><input id="password" name="password" type="password" autocomplete="current-password" placeholder="输入你的密码" required maxlength="512"><button id="toggle-password" type="button" aria-label="显示密码" aria-pressed="false">显示</button></div>
    ${enabled ? `<label id="code-label" for="code">Google Authenticator 验证码</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="输入 6 位动态码" required maxlength="32" spellcheck="false" autocapitalize="none"><label class="recovery-toggle"><input id="recovery-mode" type="checkbox">使用恢复码</label>` : ""}
    <button class="submit" type="submit">${required && !enabled ? "下一步：绑定验证器" : "进入办公室"}<span aria-hidden="true">↗</span></button></form>
    <p class="session-note">${required && !enabled ? "绑定确认前，办公室和会话接口保持锁定。" : "登录状态保留 7 天，刷新无需重新验证。"}</p>`;
}
async function enrollmentView({ username, csrf, secret, uri, error }) {
  const qr = await QRCode.toDataURL(uri, { width: 232, margin: 2, errorCorrectionLevel: "M" });
  return `<span class="welcome-tag">安全设置</span><h1 id="login-title">绑定你的验证器</h1>
    <p class="intro">在 Google Authenticator 点「＋」扫描下方二维码，再输入手机上显示的 6 位动态码。</p>
    ${errorBox(error)}<img class="auth-qr" src="${escape(qr)}" width="232" height="232" alt="Claw3D 验证器绑定二维码">
    <details class="manual-key"><summary>正在用同一部手机？手动添加</summary><p>在验证器中选「输入设置密钥」，账号填 <strong>Claw3D: ${escape(username)}</strong>，类型选「基于时间」。</p><code id="setup-key">${escape(secret)}</code><button class="secondary" id="copy-setup-key" type="button">复制设置密钥</button></details>
    <form action="/auth/totp/confirm" method="post">${csrfInput(csrf)}<label for="code">验证器中的 6 位动态码</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="000000"><button class="submit" type="submit">确认并开启两步验证 <span aria-hidden="true">↗</span></button></form>
    <p class="setup-note">绑定页面 10 分钟内有效。二维码和密钥请勿分享或发送到聊天。</p><a class="back-link" href="/login">返回登录</a>`;
}
function recoveryView(codes) {
  return `<span class="welcome-tag">两步验证已开启</span><h1 id="login-title">保存你的恢复码</h1><p class="intro">手机丢失或验证器不可用时，可用密码加任意一条恢复码登录。每条只能使用一次，完整列表只在这里显示。</p>
    <textarea id="recovery-codes" class="recovery-codes" aria-label="一次性恢复码" rows="8" readonly spellcheck="false">${escape(codes.join("\n"))}</textarea>
    <button class="secondary" id="copy-recovery-codes" type="button">复制恢复码</button><p class="setup-note">请保存到安全的位置，不要发送到聊天。</p><a class="submit" href="/office">进入办公室 <span aria-hidden="true">↗</span></a>`;
}
module.exports = { loginView, enrollmentView, recoveryView };
