/* pointer orbit and parallax, shared by every page */
const orbit = document.getElementById('orbit');
const layers = [...document.querySelectorAll('.sky, .hero')];
let mx = -100, my = -100, ox = -100, oy = -100;
addEventListener('pointermove', (e) => {
  mx = e.clientX; my = e.clientY;
  const px = (e.clientX / innerWidth - 0.5) * 2;
  const py = (e.clientY / innerHeight - 0.5) * 2;
  for (const el of layers) { el.style.setProperty('--px', px.toFixed(3)); el.style.setProperty('--py', py.toFixed(3)); }
  orbit.classList.toggle('on-sky', Boolean(e.target.closest('.sky, .hero')));
  orbit.classList.toggle('wide', Boolean(e.target.closest('a, button, tbody tr, .figures p, select')));
}, { passive: true });
addEventListener('pointerleave', () => { mx = -100; my = -100; });
(function follow() {
  ox += (mx - ox) * 0.18; oy += (my - oy) * 0.18;
  orbit.style.setProperty('--x', ox.toFixed(1) + 'px');
  orbit.style.setProperty('--y', oy.toFixed(1) + 'px');
  requestAnimationFrame(follow);
})();
const nav = document.querySelector(`[data-nav="${document.body.dataset.page}"]`);
if (nav) nav.classList.add('here');
