document.querySelector('form').addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget, button=form.querySelector('button'), message=document.getElementById('message');
  button.disabled=true;message.textContent='Đang đăng nhập…';
  try {
    if(!window.OCWebConnection)throw new Error('Chưa cấu hình địa chỉ máy chủ.');
    await window.OCWebConnection.signIn(form.elements.email.value,form.elements.password.value);
    form.elements.password.value='';
    const base=window.OC_WEB_CONFIG.basePath||'/';
    const next=new URL(new URLSearchParams(location.search).get('next')||base+'desktop/platform.html',location.origin);
    location.replace(next.origin===location.origin && next.pathname.startsWith(base) && !next.pathname.endsWith('/web/login.html')?next.href:base+'desktop/platform.html');
  } catch(error) { message.textContent=error instanceof TypeError?'Không kết nối được máy chủ. Kiểm tra máy chủ và tunnel.':error.message; }
  finally { button.disabled=false; }
});
