(() => {
  const form = document.querySelector('form');
  const button = form.querySelector('[type="submit"]');
  const label = button.querySelector('.button-label');
  const message = document.getElementById('message');
  const password = form.elements.password;
  const toggle = form.querySelector('.password-toggle');
  const capsLock = document.getElementById('caps-lock');
  let pending = false;

  toggle.addEventListener('click', () => {
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(visible));
    toggle.setAttribute('aria-label', visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
  });
  const updateCapsLock = event => { capsLock.hidden = !event.getModifierState('CapsLock'); };
  password.addEventListener('keydown', updateCapsLock);
  password.addEventListener('keyup', updateCapsLock);
  password.addEventListener('blur', () => { capsLock.hidden = true; });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending) return;
    pending = true;
    button.disabled = true;
    form.setAttribute('aria-busy', 'true');
    label.textContent = 'Đang đăng nhập…';
    message.hidden = false;
    message.dataset.state = 'pending';
    message.textContent = 'Đang kết nối với workspace…';
    try {
      if (!window.OCWebConnection) throw new Error('Chưa cấu hình địa chỉ máy chủ.');
      await window.OCWebConnection.signIn(form.elements.email.value.trim(), password.value);
      password.value = '';
      const base = window.OC_WEB_CONFIG.basePath || '/';
      const next = new URL(new URLSearchParams(location.search).get('next') || base + 'desktop/platform.html', location.origin);
      location.replace(next.origin === location.origin && next.pathname.startsWith(base) && !next.pathname.endsWith('/web/login.html') ? next.href : base + 'desktop/platform.html');
    } catch (error) {
      message.dataset.state = 'error';
      message.textContent = error instanceof TypeError || error.name === 'TimeoutError'
        ? 'Không kết nối được workspace. Kiểm tra kết nối mạng rồi thử lại.'
        : error.message;
    } finally {
      pending = false;
      button.disabled = false;
      form.setAttribute('aria-busy', 'false');
      label.textContent = 'Đăng nhập';
    }
  });
})();
