(() => {
  'use strict';

  const config = window.NARA_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const elements = {
    grid: $('product-grid'), status: $('catalog-status'), filters: $('category-filters'), search: $('search-input'),
    empty: $('empty-results'), clearSearch: $('clear-search'), headerWhatsapp: $('header-whatsapp'), customOrderLink: $('custom-order-link'),
    openCart: $('open-cart'), cartCount: $('cart-count'), floatingCartTotal: $('floating-cart-total'), cartHeaderCount: $('cart-header-count'),
    cartBackdrop: $('cart-backdrop'), cartDrawer: $('cart-drawer'), closeCart: $('close-cart'), cartEmpty: $('cart-empty'), cartItems: $('cart-items'),
    cartFooter: $('cart-footer'), cartSubtotal: $('cart-subtotal'), cartShippingNote: $('cart-shipping-note'), checkout: $('checkout-whatsapp'),
    continueShopping: $('continue-shopping'), shippingMessage: $('shipping-message'), shippingRemaining: $('shipping-remaining'), shippingFill: $('shipping-progress-fill'),
    modalBackdrop: $('product-modal-backdrop'), productModal: $('product-modal'), closeProductModal: $('close-product-modal'), modalImage: $('modal-product-image'),
    modalImagePlaceholder: $('modal-image-placeholder'), modalImagePrev: $('modal-image-prev'), modalImageNext: $('modal-image-next'), modalImageCounter: $('modal-image-counter'), modalCategory: $('modal-product-category'), modalBrand: $('modal-product-brand'), modalName: $('modal-product-name'),
    modalPrice: $('modal-product-price'), modalAvailability: $('modal-product-availability'), modalDescription: $('modal-product-description'),
    modalFields: $('modal-product-fields'), modalAdd: $('modal-add-to-cart'), modalWhatsapp: $('modal-consult-whatsapp'), toast: $('toast-message')
  };

  const STORAGE_KEY = 'nara_beauty_cart_v1';
  const CALLBACK_NAME = 'NaraCatalogoCallback';
  const state = {
    products: [], category: 'Todas', query: '', cart: readCart(), apiWarnings: [], currentProduct: null,
    lastFocus: null, toastTimer: null, requestDone: false, currentImages: [], currentImageIndex: 0
  };

  function readCart() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(saved)) return [];
      return saved.filter(item => item && item.id != null && Number(item.quantity) > 0)
        .map(item => ({ id: String(item.id), quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)) }));
    } catch (_) { return []; }
  }

  function saveCart() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.cart)); } catch (_) { /* El carrito sigue funcionando durante esta sesión. */ }
  }

  function normalizeText(value) {
    return String(value == null ? '' : value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function priceNumber(product) {
    if (!product) return 0;
    const numeric = Number(product.precioNumerico);
    if (Number.isFinite(numeric) && numeric > 0) return Math.round(numeric);
    const text = String(product.precio || '').trim();
    const digits = text.replace(/[^0-9]/g, '');
    const parsed = Number(digits);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  // La API entrega la columna STOCK en el campo disponibilidad.
  // Un número mayor que cero significa EN STOCK; cero, vacío o texto ambiguo significa CONSULTAR STOCK.
  function getStockStatus(product) {
    const raw = product && (product.disponibilidad != null ? product.disponibilidad : product.stock);
    const value = String(raw == null ? '' : raw).trim();
    const normalized = normalizeText(value);
    if (!value) return { available: false, label: 'CONSULTAR STOCK' };

    const numeric = Number(value.replace(',', '.'));
    if (Number.isFinite(numeric)) {
      return numeric > 0
        ? { available: true, label: 'EN STOCK' }
        : { available: false, label: 'CONSULTAR STOCK' };
    }

    if (['en stock', 'disponible', 'disponibles', 'si', 'true', 'hay stock', 'stock disponible'].includes(normalized)) {
      return { available: true, label: 'EN STOCK' };
    }
    return { available: false, label: 'CONSULTAR STOCK' };
  }

  function formatGs(value) {
    const amount = Math.max(0, Math.round(Number(value) || 0));
    let formatted;
    try { formatted = new Intl.NumberFormat(config.CURRENCY_LOCALE || 'es-PY', { maximumFractionDigits: 0 }).format(amount); }
    catch (_) { formatted = String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
    return `Gs. ${formatted}`;
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

  function setStatus(message, isError = false) {
    elements.status.textContent = message;
    elements.status.classList.toggle('error', Boolean(isError));
    elements.status.hidden = false;
  }

  function loadCatalog() {
    const baseUrl = String(config.API_URL || '').trim();
    if (!baseUrl || baseUrl.includes('PEGAR_URL')) {
      setStatus('Falta configurar la URL /exec de Apps Script en assets/js/config.js.', true);
      return;
    }

    let url;
    try { url = new URL(baseUrl); }
    catch (_) { setStatus('La URL de Apps Script en config.js no es válida. Debe terminar en /exec.', true); return; }

    setStatus('Conectando con la planilla…');
    const script = document.createElement('script');
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
      setStatus('No pudimos conectar con la planilla. Revisá la URL /exec y la implementación de Apps Script.', true);
    }, 20000);

    window[CALLBACK_NAME] = (response) => {
      if (finished) return;
      finished = true;
      state.requestDone = true;
      window.clearTimeout(timeout);
      script.remove();
      if (!response || response.ok !== true || !Array.isArray(response.products)) {
        setStatus((response && response.message) || 'La API respondió con un formato inesperado. Actualizá el proyecto API y volvé a implementar la versión.', true);
        return;
      }

      state.products = response.products;
      state.apiWarnings = [];
      const mapped = response.meta && response.meta.columnasDetectadas ? response.meta.columnasDetectadas : null;
      if (!mapped) {
        state.apiWarnings.push('La API no está devolviendo diagnóstico de columnas. Pegá el Code.gs actualizado en el proyecto API NUEVO y volvé a implementarlo como nueva versión.');
      } else {
        if (!mapped.precio) state.apiWarnings.push('No se detectó una columna de precio. Revisá que el encabezado de la planilla coincida con los nombres admitidos en Code.gs.');
        if (!mapped.imagen) state.apiWarnings.push('No se detectó una columna de imagen/foto. Revisá el encabezado de esa columna en la planilla.');
        if (!mapped.descripcion && !mapped.beneficios && !mapped.especificaciones && !mapped.modoUso) {
          state.apiWarnings.push('No se detectaron columnas de descripción, beneficios, especificaciones ni modo de uso; agregá o asigná esos encabezados si existen en la planilla.');
        }
      }
      const productsWithoutPrice = state.products.filter(p => priceNumber(p) <= 0).length;
      if (productsWithoutPrice > 0) state.apiWarnings.push(`${productsWithoutPrice} producto(s) no tienen un precio numérico reconocible.`);

      const validIds = new Set(state.products.map(p => String(p.id)));
      state.cart = state.cart.filter(item => validIds.has(String(item.id)));
      saveCart();
      renderCategories();
      renderProducts();
      renderCart();
      updateStatus();
    };

    script.onerror = () => {
      if (finished) return;
      finished = true;
      state.requestDone = true;
      window.clearTimeout(timeout);
      script.remove();
      setStatus('No se pudo cargar la información. Comprobá la URL /exec, el acceso de la aplicación web y que hayas implementado la versión nueva de Apps Script.', true);
    };
    document.head.appendChild(script);
  }

  function updateStatus() {
    if (!state.requestDone) return;
    const products = getFilteredProducts();
    let message = `${products.length} producto${products.length === 1 ? '' : 's'} encontrado${products.length === 1 ? '' : 's'}.`;
    if (state.apiWarnings.length) message += `\nRevisar: ${state.apiWarnings.join(' ')}`;
    setStatus(message, state.apiWarnings.some(w => w.toLowerCase().includes('no se detectó una columna de precio')));
  }

  function renderCategories() {
    const categories = [...new Set(state.products.map(p => String(p.categoria || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'es'));
    elements.filters.replaceChildren();
    elements.filters.appendChild(createFilterButton('Todas', 'Todos'));
    categories.forEach(category => elements.filters.appendChild(createFilterButton(category, category)));
  }

  function createFilterButton(value, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `filter-chip${state.category === value ? ' active' : ''}`;
    button.dataset.category = value;
    button.textContent = label;
    button.addEventListener('click', () => { state.category = value; renderCategories(); renderProducts(); });
    return button;
  }

  function appendProductImage(container, product, useModal = false) {
    const img = document.createElement('img');
    const placeholder = document.createElement('div');
    placeholder.className = useModal ? 'modal-image-placeholder' : 'image-placeholder';
    placeholder.textContent = 'NARA BEAUTY';
    const imageUrl = String(product.imagen || '').trim();
    img.alt = product.nombre ? `Foto de ${product.nombre}` : 'Producto de skincare';
    img.loading = useModal ? 'eager' : 'lazy';
    img.referrerPolicy = 'no-referrer';
    if (imageUrl) {
      img.src = imageUrl;
      placeholder.hidden = true;
    } else {
      img.hidden = true;
      placeholder.hidden = false;
    }
    img.addEventListener('error', () => { img.hidden = true; placeholder.hidden = false; });
    img.addEventListener('load', () => { img.hidden = false; placeholder.hidden = true; });
    container.append(img, placeholder);
    return { img, placeholder };
  }

  function createProductCard(product) {
    const card = document.createElement('article');
    card.className = 'product-card';
    card.setAttribute('aria-label', `Producto ${product.nombre || ''}. Seleccioná para ver los detalles.`);
    card.title = 'Hacé clic para ver precio y detalles';
    card.addEventListener('click', event => {
      if (event.target.closest('button, a')) return;
      openProductModal(product);
    });

    const media = document.createElement('div');
    media.className = 'product-media';
    appendProductImage(media, product);
    media.addEventListener('click', () => openProductModal(product));

    const details = document.createElement('div');
    details.className = 'product-details';
    if (product.categoria) {
      const category = document.createElement('p'); category.className = 'product-category'; category.textContent = product.categoria; details.appendChild(category);
    }
    const title = document.createElement('button');
    title.type = 'button'; title.className = 'product-name'; title.textContent = product.nombre || 'Producto';
    title.addEventListener('click', () => openProductModal(product)); details.appendChild(title);
    if (product.marca) { const brand = document.createElement('p'); brand.className = 'product-brand'; brand.textContent = product.marca; details.appendChild(brand); }
    const stock = getStockStatus(product);
    const stockBadge = document.createElement('span');
    stockBadge.className = `product-stock-badge ${stock.available ? 'stock-in-stock' : 'stock-consult'}`;
    stockBadge.textContent = stock.label;
    stockBadge.setAttribute('aria-label', `Disponibilidad: ${stock.label}`);
    details.appendChild(stockBadge);
    // La descripción se muestra únicamente en la ventana de detalles al pulsar «Ver».

    const bottom = document.createElement('div'); bottom.className = 'product-bottom';
    const price = document.createElement('p'); price.className = 'product-price';
    const value = priceNumber(product);
    price.textContent = value > 0 ? formatGs(value) : 'Precio a consultar';
    bottom.appendChild(price);
    const actions = document.createElement('div'); actions.className = 'product-actions';
    const view = document.createElement('button'); view.type = 'button'; view.className = 'product-details-link'; view.textContent = 'Ver'; view.setAttribute('aria-label', `Ver detalles de ${product.nombre || 'producto'}`);
    view.addEventListener('click', event => { event.stopPropagation(); openProductModal(product); });
    if (stock.available && value > 0) {
      const add = document.createElement('button'); add.type = 'button'; add.className = 'product-add';
      add.textContent = '＋ Agregar al carrito';
      add.addEventListener('click', event => { event.stopPropagation(); addToCart(product); });
      actions.append(add, view);
    } else {
      const consult = document.createElement('a');
      consult.className = 'product-consult-whatsapp';
      consult.textContent = 'Consultar por WhatsApp';
      consult.href = makeWhatsAppLink(`Hola, quiero consultar la disponibilidad de ${product.nombre || 'este producto'}${value > 0 ? ` (precio publicado: ${formatGs(value)})` : ''}. ¿Tienen stock?`);
      consult.target = '_blank'; consult.rel = 'noopener noreferrer';
      consult.setAttribute('aria-label', `Consultar por WhatsApp la disponibilidad de ${product.nombre || 'producto'}`);
      consult.addEventListener('click', event => event.stopPropagation());
      actions.append(consult, view);
    }
    bottom.appendChild(actions); details.appendChild(bottom);
    card.append(media, details);
    return card;
  }

  function getFilteredProducts() {
    const query = normalizeText(state.query);
    return state.products.filter(product => {
      const categoryMatch = state.category === 'Todas' || String(product.categoria || '') === state.category;
      const combined = normalizeText([product.nombre, product.descripcion, product.beneficios, product.especificaciones, product.modoUso, product.ingredientes, product.tipoPiel, product.recomendacion, product.precauciones, product.frecuencia, product.rutina, product.categoria, product.marca].join(' '));
      return categoryMatch && (!query || combined.includes(query));
    });
  }

  function renderProducts() {
    const products = getFilteredProducts();
    elements.grid.replaceChildren();
    products.forEach(product => elements.grid.appendChild(createProductCard(product)));
    elements.empty.hidden = products.length > 0 || state.products.length === 0;
    updateStatus();
  }

  function addDetailField(title, value, link = false) {
    if (!value) return;
    const section = document.createElement('section'); section.className = 'detail-field';
    const heading = document.createElement('h3'); heading.textContent = title; section.appendChild(heading);
    if (link) {
      const anchor = document.createElement('a'); anchor.href = value; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.textContent = 'Ver enlace del producto ↗'; section.appendChild(anchor);
    } else {
      const content = document.createElement('p'); content.textContent = value; section.appendChild(content);
    }
    elements.modalFields.appendChild(section);
  }

  function renderModalImage() {
    const images = state.currentImages || [];
    const count = images.length;
    const hasMany = count > 1;
    elements.modalImage.hidden = true;
    elements.modalImage.removeAttribute('src');
    elements.modalImagePlaceholder.hidden = count > 0;
    elements.modalImagePlaceholder.textContent = 'NARA BEAUTY';
    elements.modalImagePrev.hidden = !hasMany;
    elements.modalImageNext.hidden = !hasMany;
    elements.modalImageCounter.hidden = !hasMany;
    elements.modalImageCounter.textContent = count ? `${state.currentImageIndex + 1} / ${count}` : '0 / 0';
    elements.modalImage.alt = `Foto ${state.currentImageIndex + 1} de ${count} de ${state.currentProduct?.nombre || 'producto'}`;
    if (!count) return;
    const url = images[state.currentImageIndex];
    elements.modalImage.onload = () => { elements.modalImage.hidden = false; elements.modalImagePlaceholder.hidden = true; };
    elements.modalImage.onerror = () => { elements.modalImage.hidden = true; elements.modalImagePlaceholder.hidden = false; };
    elements.modalImage.src = url;
  }

  function moveModalImage(direction) {
    const count = state.currentImages.length;
    if (count < 2) return;
    state.currentImageIndex = (state.currentImageIndex + direction + count) % count;
    renderModalImage();
  }

  function openProductModal(product) {
    if (!product) return;
    state.currentProduct = product;
    state.lastFocus = document.activeElement;
    elements.modalCategory.textContent = product.categoria || '';
    elements.modalBrand.textContent = product.marca || '';
    elements.modalBrand.hidden = !product.marca;
    elements.modalName.textContent = product.nombre || 'Producto';
    const value = priceNumber(product);
    elements.modalPrice.textContent = value > 0 ? formatGs(value) : (product.precio || 'Precio a consultar');
    const stock = getStockStatus(product);
    elements.modalAvailability.textContent = stock.label;
    elements.modalAvailability.classList.toggle('stock-in-stock', stock.available);
    elements.modalAvailability.classList.toggle('stock-consult', !stock.available);
    elements.modalAvailability.hidden = false;
    elements.modalAvailability.setAttribute('aria-label', `Disponibilidad: ${stock.label}`);
    elements.modalDescription.textContent = product.descripcion || '';
    elements.modalDescription.hidden = !product.descripcion;
    elements.modalFields.replaceChildren();
    addDetailField('Beneficios', product.beneficios);
    addDetailField('Especificaciones', product.especificaciones);
    addDetailField('Modo de uso', product.modoUso);
    addDetailField('Ingredientes', product.ingredientes);
    addDetailField('Tipo de piel recomendado', product.tipoPiel);
    addDetailField('Recomendado para', product.recomendacion);
    addDetailField('Frecuencia de uso', product.frecuencia);
    addDetailField('Momento o paso de rutina', product.rutina);
    addDetailField('Precauciones', product.precauciones);
    addDetailField('Presentación', product.presentacion);
    addDetailField('Contenido', product.contenido);
    addDetailField('Más información', product.link, true);
    if (!elements.modalFields.children.length && !product.descripcion) {
      addDetailField('Información', 'La planilla no tiene más detalles cargados para este producto.');
    }

    // Galería: prioriza el array de la API y mantiene compatibilidad con productos antiguos.
    const rawImages = Array.isArray(product.imagenes) ? product.imagenes : [product.imagen];
    state.currentImages = [...new Set(rawImages.map(url => String(url || '').trim()).filter(Boolean))];
    if (!state.currentImages.length && product.imagen) state.currentImages = [String(product.imagen).trim()];
    state.currentImageIndex = 0;
    renderModalImage();

    // Solo se permite agregar al carrito si la columna STOCK confirma disponibilidad y hay precio numérico.
    elements.modalAdd.hidden = !stock.available || value <= 0;
    elements.modalAdd.disabled = !stock.available || value <= 0;
    elements.modalAdd.textContent = '＋ Agregar al carrito';
    elements.modalAdd.onclick = () => {
      const current = state.currentProduct;
      if (current && getStockStatus(current).available && priceNumber(current) > 0) addToCart(current);
    };
    const query = `Hola, quiero consultar por ${product.nombre || 'este producto'}${value > 0 ? ` (precio publicado: ${formatGs(value)})` : ''}. ¿Podrían confirmarme disponibilidad y detalles?`;
    elements.modalWhatsapp.href = makeWhatsAppLink(query);
    elements.modalWhatsapp.textContent = stock.available ? 'Consultar por WhatsApp' : 'Consultar por WhatsApp';
    elements.modalWhatsapp.onclick = null;

    elements.modalBackdrop.hidden = false;
    elements.productModal.hidden = false;
    document.body.classList.add('no-scroll');
    elements.closeProductModal.focus();
  }

  function closeProductModal(restoreFocus = true) {
    elements.modalBackdrop.hidden = true;
    elements.productModal.hidden = true;
    state.currentProduct = null;
    if (!elements.cartDrawer.classList.contains('open')) document.body.classList.remove('no-scroll');
    if (restoreFocus && state.lastFocus && typeof state.lastFocus.focus === 'function') state.lastFocus.focus();
  }

  function productById(id) { return state.products.find(product => String(product.id) === String(id)); }
  function getCartLines() { return state.cart.map(item => ({ item, product: productById(item.id) })).filter(line => line.product); }
  function getTotalItems() { return getCartLines().reduce((sum, line) => sum + line.item.quantity, 0); }
  function getSubtotal() { return getCartLines().reduce((sum, line) => sum + priceNumber(line.product) * line.item.quantity, 0); }

  function addToCart(product) {
    const unitPrice = priceNumber(product);
    if (unitPrice <= 0) { showToast('No hay un precio numérico disponible para este producto.'); return; }
    const id = String(product.id);
    const existing = state.cart.find(item => item.id === id);
    if (existing) existing.quantity += 1; else state.cart.push({ id, quantity: 1 });
    saveCart(); renderCart(); showToast(`${product.nombre || 'Producto'} agregado al carrito.`);
  }

  function changeQuantity(id, delta) {
    const item = state.cart.find(line => line.id === String(id));
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) state.cart = state.cart.filter(line => line.id !== String(id));
    saveCart(); renderCart();
  }

  // Quita completamente un producto del carrito, sin modificar el catálogo.
  function removeFromCart(id) {
    const product = productById(id);
    const exists = state.cart.some(line => line.id === String(id));
    if (!exists) return;
    state.cart = state.cart.filter(line => line.id !== String(id));
    saveCart();
    renderCart();
    showToast(`${product && product.nombre ? product.nombre : 'Producto'} quitado del carrito.`);
  }

  function renderCart() {
    const lines = getCartLines();
    const itemCount = getTotalItems();
    const subtotal = getSubtotal();
    elements.cartCount.textContent = String(itemCount);
    elements.cartCount.setAttribute('aria-label', `${itemCount} artículo${itemCount === 1 ? '' : 's'}`);
    elements.cartHeaderCount.textContent = `(${itemCount})`;
    elements.floatingCartTotal.textContent = formatGs(subtotal);
    elements.cartSubtotal.textContent = formatGs(subtotal);
    elements.cartItems.replaceChildren();
    lines.forEach(({ item, product }) => elements.cartItems.appendChild(createCartItem(item, product)));
    const isEmpty = lines.length === 0;
    elements.cartEmpty.hidden = !isEmpty;
    elements.cartFooter.hidden = isEmpty;
    elements.cartItems.hidden = isEmpty;
    elements.shippingProgressBox = $('shipping-progress-box');
    if (elements.shippingProgressBox) elements.shippingProgressBox.hidden = isEmpty;
    updateShippingProgress(subtotal);
    const minimum = Math.max(0, Number(config.FREE_SHIPPING_MINIMUM) || 0);
    const freeShipping = minimum > 0 && subtotal >= minimum;
    elements.cartShippingNote.textContent = freeShipping ? '¡Tu compra alcanza el mínimo configurado para envío gratis!' : 'El costo de envío se confirma por WhatsApp al coordinar la entrega.';
  }

  function createCartItem(item, product) {
    const row = document.createElement('article'); row.className = 'cart-item';
    const imageUrl = String(product.imagen || '').trim();
    if (imageUrl) {
      const image = document.createElement('img'); image.className = 'cart-item-image'; image.alt = ''; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; image.src = imageUrl;
      image.addEventListener('error', () => { const placeholder = document.createElement('div'); placeholder.className = 'cart-item-image-placeholder'; placeholder.textContent = 'NARA'; image.replaceWith(placeholder); });
      row.appendChild(image);
    } else {
      const placeholder = document.createElement('div'); placeholder.className = 'cart-item-image-placeholder'; placeholder.textContent = 'NARA'; row.appendChild(placeholder);
    }
    const info = document.createElement('div');
    const name = document.createElement('p'); name.className = 'cart-item-name'; name.textContent = product.nombre || 'Producto'; info.appendChild(name);
    const unit = priceNumber(product); const unitText = document.createElement('p'); unitText.className = 'cart-item-unit'; unitText.textContent = `${formatGs(unit)} c/u`; info.appendChild(unitText);
    const meta = document.createElement('div'); meta.className = 'cart-item-meta';
    const quantity = document.createElement('div'); quantity.className = 'quantity-control'; quantity.setAttribute('aria-label', `Cantidad de ${product.nombre || 'producto'}`);
    const minus = document.createElement('button'); minus.type = 'button'; minus.textContent = '−'; minus.setAttribute('aria-label', 'Disminuir una unidad'); minus.addEventListener('click', () => changeQuantity(item.id, -1));
    const count = document.createElement('span'); count.textContent = String(item.quantity); count.setAttribute('aria-live', 'polite');
    const plus = document.createElement('button'); plus.type = 'button'; plus.textContent = '+'; plus.setAttribute('aria-label', 'Agregar una unidad'); plus.addEventListener('click', () => changeQuantity(item.id, 1));
    quantity.append(minus, count, plus);

    const controls = document.createElement('div'); controls.className = 'cart-item-controls';
    controls.appendChild(quantity);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'cart-remove-button';
    remove.innerHTML = '<span class="cart-remove-icon" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="M3 4.7h10M6 4.7V3.5h4v1.2M4.5 4.7l.55 8h5.9l.55-8M6.5 7v3.8M9.5 7v3.8" /></svg></span><span class="cart-remove-label">Quitar</span>';
    remove.setAttribute('aria-label', `Quitar ${product.nombre || 'producto'} del carrito`);
    remove.title = 'Quitar este producto del carrito';
    remove.addEventListener('click', () => removeFromCart(item.id));
    controls.appendChild(remove);
    meta.appendChild(controls);

    const lineTotal = document.createElement('strong'); lineTotal.className = 'cart-line-total'; lineTotal.textContent = formatGs(unit * item.quantity); meta.appendChild(lineTotal);
    info.appendChild(meta); row.appendChild(info); return row;
  }

  function updateShippingProgress(subtotal) {
    const minimum = Math.max(0, Number(config.FREE_SHIPPING_MINIMUM) || 0);
    const reached = minimum > 0 && subtotal >= minimum;
    const progressBox = elements.shippingProgressBox || $('shipping-progress-box');

    // La barra completa cambia a verde cuando el subtotal llega al mínimo configurado.
    if (progressBox) progressBox.classList.toggle('shipping-complete', reached);

    if (minimum <= 0) {
      elements.shippingMessage.textContent = 'Consultá el mínimo de envío gratis por WhatsApp';
      elements.shippingRemaining.textContent = '';
      elements.shippingFill.style.width = '0%';
      return;
    }
    if (reached) {
      elements.shippingMessage.textContent = '¡Ya alcanzaste el envío gratis!';
      elements.shippingRemaining.textContent = 'Completado';
      elements.shippingFill.style.width = '100%';
    } else {
      const missing = minimum - subtotal;
      elements.shippingMessage.textContent = `Envío gratis desde ${formatGs(minimum)}`;
      elements.shippingRemaining.textContent = `Te faltan ${formatGs(missing)}`;
      elements.shippingFill.style.width = `${Math.min(100, (subtotal / minimum) * 100)}%`;
    }
  }

  function openCart() {
    closeProductModal(false);
    elements.cartBackdrop.hidden = false;
    elements.cartDrawer.classList.add('open');
    elements.cartDrawer.removeAttribute('inert');
    elements.cartDrawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
    elements.closeCart.focus();
  }

  function closeCart(restoreFocus = true) {
    elements.cartBackdrop.hidden = true;
    elements.cartDrawer.classList.remove('open');
    elements.cartDrawer.setAttribute('aria-hidden', 'true');
    elements.cartDrawer.setAttribute('inert', '');
    if (elements.productModal.hidden) document.body.classList.remove('no-scroll');
    if (restoreFocus) elements.openCart.focus();
  }

  function concludeByWhatsApp() {
    const lines = getCartLines();
    if (!lines.length) { showToast('Tu carrito está vacío.'); return; }
    const subtotal = getSubtotal();
    const minimum = Math.max(0, Number(config.FREE_SHIPPING_MINIMUM) || 0);
    const freeShipping = minimum > 0 && subtotal >= minimum;
    const messageLines = [
      `Hola ${config.STORE_NAME || 'NARA BEAUTY'}, quiero concluir esta compra:`,
      '',
      ...lines.map(({ item, product }) => `• ${item.quantity} x ${product.nombre} — ${formatGs(priceNumber(product) * item.quantity)} (${formatGs(priceNumber(product))} c/u)`),
      '',
      `TOTAL DE PRODUCTOS: ${formatGs(subtotal)}`,
      `Envío: ${freeShipping ? 'GRATIS (se alcanzó el mínimo indicado)' : 'costo a confirmar por WhatsApp'}`,
      '',
      'Por favor, confirmen disponibilidad, costo/condiciones de entrega y forma de pago.'
    ];
    const link = makeWhatsAppLink(messageLines.join('\n'));
    window.open(link, '_blank', 'noopener,noreferrer');
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    if (state.toastTimer) window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 2600);
  }

  elements.search.addEventListener('input', event => { state.query = event.target.value; renderProducts(); });
  elements.clearSearch.addEventListener('click', () => { state.query = ''; elements.search.value = ''; state.category = 'Todas'; renderCategories(); renderProducts(); });
  elements.openCart.addEventListener('click', openCart);
  elements.closeCart.addEventListener('click', () => closeCart());
  elements.cartBackdrop.addEventListener('click', () => closeCart());
  elements.continueShopping.addEventListener('click', () => { closeCart(); $('catalogo').scrollIntoView({ behavior: 'smooth' }); });
  elements.checkout.addEventListener('click', concludeByWhatsApp);
  elements.closeProductModal.addEventListener('click', () => closeProductModal());
  elements.modalBackdrop.addEventListener('click', () => closeProductModal());
  elements.modalImagePrev.addEventListener('click', () => moveModalImage(-1));
  elements.modalImageNext.addEventListener('click', () => moveModalImage(1));
  document.addEventListener('keydown', event => {
    if (!elements.productModal.hidden && event.key === 'ArrowLeft') { moveModalImage(-1); return; }
    if (!elements.productModal.hidden && event.key === 'ArrowRight') { moveModalImage(1); return; }
    if (event.key !== 'Escape') return;
    if (elements.cartDrawer.classList.contains('open')) closeCart();
    else if (!elements.productModal.hidden) closeProductModal();
  });

  initWhatsAppLinks();
  renderCart();
  loadCatalog();
})();
