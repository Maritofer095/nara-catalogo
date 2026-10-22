(() => {
  'use strict';

  const config = window.NARA_CONFIG || {};
  const elements = {
    grid: document.getElementById('product-grid'),
    status: document.getElementById('catalog-status'),
    filters: document.getElementById('category-filters'),
    search: document.getElementById('search-input'),
    empty: document.getElementById('empty-results'),
    clearSearch: document.getElementById('clear-search'),
    headerWhatsapp: document.getElementById('header-whatsapp'),
    customOrderLink: document.getElementById('custom-order-link')
  };

  const state = { products: [], category: 'Todas', query: '' };
  const CALLBACK_NAME = 'NaraCatalogoCallback';

  function setStatus(message, isError = false) {
    elements.status.textContent = message;
    elements.status.classList.toggle('error', isError);
    elements.status.hidden = false;
  }

  function makeWhatsAppLink(message) {
    const phone = String(config.WHATSAPP_PHONE || '').replace(/\D/g, '');
    const text = encodeURIComponent(message);
    if (!phone || phone.includes('XXXXXXXXX')) return `https://wa.me/?text=${text}`;
    return `https://wa.me/${phone}?text=${text}`;
  }

  function initWhatsAppLinks() {
    const generalMessage = `Hola, quiero consultar sobre los productos de ${config.STORE_NAME || 'NARA BEAUTY'}.`;
    const url = makeWhatsAppLink(generalMessage);
    elements.headerWhatsapp.href = url;
    elements.headerWhatsapp.target = '_blank';
    elements.headerWhatsapp.rel = 'noopener noreferrer';
    elements.customOrderLink.href = url;
  }

  function loadCatalog() {
    const baseUrl = String(config.API_URL || '').trim();
    if (!baseUrl || baseUrl.includes('PEGAR_URL')) {
      setStatus('Falta configurar la URL de Apps Script en assets/js/config.js.', true);
      return;
    }

    setStatus('Conectando con el catálogo…');
    const script = document.createElement('script');
    const url = new URL(baseUrl);
    url.searchParams.set('api', 'catalogo');
    url.searchParams.set('callback', CALLBACK_NAME);
    url.searchParams.set('_ts', String(Date.now()));
    script.src = url.toString();
    script.async = true;

    let finished = false;
    const timeout = window.setTimeout(() => {
      if (finished) return;
      finished = true;
      script.remove();
      setStatus('No pudimos conectar con la planilla. Revisá el despliegue de Apps Script y volvé a cargar.', true);
    }, 18000);

    window[CALLBACK_NAME] = (response) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      script.remove();
      if (!response || response.ok !== true || !Array.isArray(response.products)) {
        setStatus((response && response.message) || 'La API respondió con un formato inesperado.', true);
        return;
      }
      state.products = response.products;
      setStatus(`${state.products.length} producto${state.products.length === 1 ? '' : 's'} en el catálogo.`);
      renderCategories();
      renderProducts();
    };

    script.onerror = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      script.remove();
      setStatus('No se pudo cargar la información. Comprobá la URL /exec y que el despliegue permita acceso público.', true);
    };

    document.head.appendChild(script);
  }

  function normalizeText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function renderCategories() {
    const categories = [...new Set(state.products.map(p => String(p.categoria || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'es'));
    elements.filters.replaceChildren();
    const allButton = createFilterButton('Todas', 'Todos');
    elements.filters.appendChild(allButton);
    categories.forEach(category => elements.filters.appendChild(createFilterButton(category, category)));
  }

  function createFilterButton(value, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `filter-chip${state.category === value ? ' active' : ''}`;
    button.dataset.category = value;
    button.textContent = label;
    button.addEventListener('click', () => {
      state.category = value;
      renderCategories();
      renderProducts();
    });
    return button;
  }

  function createProductCard(product) {
    const card = document.createElement('article');
    card.className = 'product-card';

    const media = document.createElement('div');
    media.className = 'product-media';
    const image = document.createElement('img');
    image.loading = 'lazy';
    image.alt = product.nombre ? `Foto de ${product.nombre}` : 'Producto de skincare';
    const imageUrl = String(product.imagen || '').trim();
    const placeholder = document.createElement('div');
    placeholder.className = 'image-placeholder';
    placeholder.textContent = 'NARA BEAUTY';
    if (imageUrl) {
      image.src = imageUrl;
      placeholder.hidden = true;
    } else {
      image.hidden = true;
      placeholder.hidden = false;
    }
    image.addEventListener('error', () => {
      image.hidden = true;
      placeholder.hidden = false;
    });
    media.append(image, placeholder);

    const details = document.createElement('div');
    details.className = 'product-details';
    if (product.categoria) {
      const category = document.createElement('p');
      category.className = 'product-category';
      category.textContent = product.categoria;
      details.appendChild(category);
    }
    const title = document.createElement('h3');
    title.className = 'product-name';
    title.textContent = product.nombre || 'Producto';
    details.appendChild(title);
    if (product.marca) {
      const brand = document.createElement('p');
      brand.className = 'product-brand';
      brand.textContent = product.marca;
      details.appendChild(brand);
    }
    if (product.descripcion) {
      const description = document.createElement('p');
      description.className = 'product-description';
      description.textContent = product.descripcion;
      details.appendChild(description);
    }

    const bottom = document.createElement('div');
    bottom.className = 'product-bottom';
    const price = document.createElement('p');
    price.className = 'product-price';
    price.textContent = product.precio || 'Consultar precio';
    bottom.appendChild(price);

    const message = `Hola, quiero consultar por: ${product.nombre || 'un producto'}${product.precio ? ` (precio publicado: ${product.precio})` : ''}.`;
    const order = document.createElement('a');
    order.className = 'product-order';
    order.href = makeWhatsAppLink(message);
    order.target = '_blank';
    order.rel = 'noopener noreferrer';
    order.textContent = 'Consultar ↗';
    bottom.appendChild(order);
    details.appendChild(bottom);
    card.append(media, details);
    return card;
  }

  function getFilteredProducts() {
    const query = normalizeText(state.query);
    return state.products.filter(product => {
      const categoryMatch = state.category === 'Todas' || String(product.categoria || '') === state.category;
      const combined = normalizeText([product.nombre, product.descripcion, product.categoria, product.marca].join(' '));
      return categoryMatch && (!query || combined.includes(query));
    });
  }

  function renderProducts() {
    const products = getFilteredProducts();
    elements.grid.replaceChildren();
    products.forEach(product => elements.grid.appendChild(createProductCard(product)));
    elements.empty.hidden = products.length > 0 || state.products.length === 0;
    if (state.products.length > 0 && products.length === 0) {
      elements.status.hidden = true;
    } else {
      elements.status.hidden = false;
      elements.status.classList.remove('error');
      elements.status.textContent = `${products.length} producto${products.length === 1 ? '' : 's'} encontrado${products.length === 1 ? '' : 's'}.`;
    }
  }

  elements.search.addEventListener('input', event => {
    state.query = event.target.value;
    renderProducts();
  });
  elements.clearSearch.addEventListener('click', () => {
    state.query = '';
    elements.search.value = '';
    state.category = 'Todas';
    renderCategories();
    renderProducts();
  });

  initWhatsAppLinks();
  loadCatalog();
})();
