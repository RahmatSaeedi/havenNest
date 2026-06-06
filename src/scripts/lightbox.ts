import GLightbox from 'glightbox';
import 'glightbox/dist/css/glightbox.min.css';

// Single shared initializer. Astro bundles this module once per page even if
// imported by multiple <Gallery /> components, so GLightbox initializes once
// and groups items by their `data-gallery` attribute.
const init = () => {
  GLightbox({
    selector: '.glightbox',
    touchNavigation: true,
    loop: true,
    openEffect: 'fade',
    closeEffect: 'fade',
    slideEffect: 'slide',
    zoomable: true,
  });
};

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
