const files = window.originalMaterials || [];
const $ = (id) => document.getElementById(id);
const isImage = (file) => /\.(jpe?g|png|webp|gif|avif|svg|bmp)$/i.test(file.path);
const url = (file) => '../' + ['原始资料', ...file.path.split('/')].map(encodeURIComponent).join('/');
const category = (file) => file.path.includes('/') ? file.path.split('/')[0] : '其他资料';
const size = (bytes) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
let selected = '全部', images = [], current = 0;
function button(text, action) {
  const el = document.createElement('button'); el.type = 'button'; el.textContent = text; el.onclick = action; return el;
}
function render() {
  const query = $('search').value.trim().toLocaleLowerCase();
  const visible = files.filter((f) => (selected === '全部' || category(f) === selected) && f.path.toLocaleLowerCase().includes(query));
  images = visible.filter(isImage);
  $('count').textContent = `共 ${visible.length} 个文件 · ${images.length} 张图片${visible.length ? '' : '，没有匹配的资料'}`;
  $('gallery').replaceChildren();
  for (const file of visible) {
    const card = document.createElement('article'); card.className = 'card';
    if (isImage(file)) {
      const open = button('', () => show(images.indexOf(file))); open.className = 'thumb'; open.setAttribute('aria-label', `查看 ${file.path}`);
      const img = document.createElement('img'); img.src = url(file); img.alt = file.path.split('/').at(-1); img.loading = 'lazy'; img.decoding = 'async';
      img.onerror = () => { img.alt = '图片加载失败，点击打开原图'; };
      open.append(img); card.append(open);
    } else {
      const icon = document.createElement('div'); icon.className = 'file-icon'; icon.textContent = file.path.split('.').at(-1).toUpperCase(); card.append(icon);
    }
    const details = document.createElement('div'); details.className = 'details';
    const name = document.createElement('strong'); name.textContent = file.path.split('/').at(-1);
    const info = document.createElement('small'); info.textContent = `${category(file)} · ${size(file.bytes)}`;
    const link = document.createElement('a'); link.href = url(file); link.download = file.path.split('/').at(-1); link.textContent = isImage(file) ? '下载原图' : '下载原文件';
    details.append(name, info, link); card.append(details); $('gallery').append(card);
  }
  for (const el of $('categories').children) el.setAttribute('aria-pressed', String(el.dataset.category === selected));
}
function show(index) {
  current = index;
  const file = images[current]; if (!file) return;
  $('full').src = url(file); $('full').alt = file.path; $('caption').textContent = file.path;
  $('original').href = $('download').href = url(file); $('download').download = file.path.split('/').at(-1);
  $('position').textContent = `${current + 1} / ${images.length}`;
  $('previous').disabled = current === 0; $('next').disabled = current === images.length - 1;
  if (!$('preview').open) $('preview').showModal();
}
for (const name of ['全部', ...new Set(files.map(category))]) {
  const el = button(`${name} (${name === '全部' ? files.length : files.filter((f) => category(f) === name).length})`, () => { selected = name; render(); });
  el.dataset.category = name; $('categories').append(el);
}
$('search').oninput = render;
$('close').onclick = () => $('preview').close();
$('previous').onclick = () => show(current - 1); $('next').onclick = () => show(current + 1);
$('preview').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' && current > 0) { e.preventDefault(); show(current - 1); }
  if (e.key === 'ArrowRight' && current < images.length - 1) { e.preventDefault(); show(current + 1); }
});
$('preview').addEventListener('close', () => $('full').removeAttribute('src'));
render();
