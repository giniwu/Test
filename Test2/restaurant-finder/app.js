let map;
let placesService;
let autocompleteService;
let currentSearchLocation = null;
let currentResults = [];

// DOM Elements
const addressInput = document.getElementById('addressInput');
const suggestionsBox = document.getElementById('suggestionsBox');
const foodTypeSelect = document.getElementById('foodType');
const priceRange = document.getElementById('priceRange');
const priceLabel = document.getElementById('priceLabel');
const sortBySelect = document.getElementById('sortBy');
const searchBtn = document.getElementById('searchBtn');
const resultsList = document.getElementById('resultsList');
const resultsCount = document.getElementById('resultsCount');
const restaurantModal = document.getElementById('restaurantModal');
const modalBody = document.getElementById('modalBody');
const closeModalBtn = document.querySelector('.close-btn');

// Price Level Mapping
const PRICE_MAP = {
    '1': { text: '$200', level: 1 },
    '2': { text: '$500', level: 2 },
    '3': { text: '$1500', level: 3 },
    '4': { text: '$3000+', level: 4 }
};

// Update Price Label
priceRange.addEventListener('input', (e) => {
    const val = e.target.value;
    priceLabel.textContent = PRICE_MAP[val].text;
});

// Initialize App
window.initApp = function() {
    try {
        map = new google.maps.Map(document.getElementById('map'), {
            center: { lat: 25.0330, lng: 121.5654 },
            zoom: 15
        });
        placesService = new google.maps.places.PlacesService(map);
        autocompleteService = new google.maps.places.AutocompleteService();
        
        setupCustomAutocomplete();
        setupGeolocation();
    } catch (e) {
        console.error("Google Maps API 載入失敗:", e);
    }

    searchBtn.addEventListener('click', performSearch);
};

// Custom Autocomplete Logic (To avoid Google "locking" the input)
function setupCustomAutocomplete() {
    let debounceTimer;
    
    addressInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = addressInput.value.trim();
        
        if (query.length < 2) {
            suggestionsBox.classList.add('hidden');
            return;
        }

        debounceTimer = setTimeout(() => {
            autocompleteService.getPlacePredictions({ input: query }, (predictions, status) => {
                if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
                    renderSuggestions(predictions);
                } else {
                    suggestionsBox.classList.add('hidden');
                }
            });
        }, 300);
    });

    // Hide suggestions when clicking outside
    document.addEventListener('click', (e) => {
        if (!addressInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
            suggestionsBox.classList.add('hidden');
        }
    });
}

function renderSuggestions(predictions) {
    suggestionsBox.innerHTML = '';
    suggestionsBox.classList.remove('hidden');

    predictions.forEach(prediction => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item.innerHTML = `
            <i class="ph ph-map-pin"></i>
            <div>
                <span class="main-text">${prediction.structured_formatting.main_text}</span>
                <span class="sub-text">${prediction.structured_formatting.secondary_text}</span>
            </div>
        `;
        item.addEventListener('click', () => {
            addressInput.value = prediction.description;
            suggestionsBox.classList.add('hidden');
            // Resolve location via geocoding
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ placeId: prediction.place_id }, (results, status) => {
                if (status === 'OK') {
                    currentSearchLocation = results[0].geometry.location;
                }
            });
        });
        suggestionsBox.appendChild(item);
    });
}

function setupGeolocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((position) => {
            currentSearchLocation = new google.maps.LatLng(position.coords.latitude, position.coords.longitude);
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ location: currentSearchLocation }, (results, status) => {
                if (status === "OK" && results[0] && !addressInput.value) {
                     addressInput.value = results[0].formatted_address;
                }
            });
        });
    }
}

async function performSearch() {
    const query = addressInput.value.trim();
    if (!query) {
        alert('請先輸入地址！');
        return;
    }

    toggleLoading(true);

    // If we don't have a location yet (or user typed something else), geocode it
    if (!currentSearchLocation || query !== addressInput.dataset.lastQuery) {
        const geocoder = new google.maps.Geocoder();
        const result = await new Promise(resolve => {
            geocoder.geocode({ address: query }, (results, status) => {
                resolve({ results, status });
            });
        });

        if (result.status === 'OK') {
            currentSearchLocation = result.results[0].geometry.location;
            addressInput.dataset.lastQuery = query;
        } else {
            toggleLoading(false);
            alert('找不到該地點，請輸入更精確的地址。');
            return;
        }
    }

    executePlacesSearch();
}

function executePlacesSearch() {
    const type = foodTypeSelect.value;
    const maxLevel = PRICE_MAP[priceRange.value].level;

    const request = {
        location: currentSearchLocation,
        radius: '3000',
        type: ['restaurant']
    };

    if (type !== 'restaurant') {
        const option = foodTypeSelect.querySelector(`option[value="${type}"]`);
        request.keyword = option.textContent.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '').trim();
    }

    placesService.nearbySearch(request, (results, status) => {
        toggleLoading(false);
        if (status === google.maps.places.PlacesServiceStatus.OK && results) {
            // Apply price filtering client-side for more flexibility
            currentResults = results.filter(place => !place.price_level || place.price_level <= maxLevel);
            
            currentResults.forEach(r => {
                r.distanceValue = r.geometry ? google.maps.geometry.spherical.computeDistanceBetween(currentSearchLocation, r.geometry.location) : 999999;
            });
            
            sortAndDisplayResults();
        } else {
            displayEmptyState('找不到符合條件的餐廳。');
        }
    });
}

function sortAndDisplayResults() {
    const sortBy = sortBySelect.value;
    currentResults.sort((a, b) => {
        if (sortBy === 'rating') {
            const ratingA = a.rating || 0;
            const ratingB = b.rating || 0;
            if (ratingA !== ratingB) return ratingB - ratingA;
            return (b.user_ratings_total || 0) - (a.user_ratings_total || 0);
        } else if (sortBy === 'distance') {
            return a.distanceValue - b.distanceValue;
        } else return 0;
    });
    renderResults();
}

sortBySelect.addEventListener('change', () => { if (currentResults.length > 0) sortAndDisplayResults(); });

function renderResults() {
    resultsList.innerHTML = '';
    resultsCount.textContent = currentResults.length;

    if (currentResults.length === 0) {
        displayEmptyState('找不到符合條件的餐廳。');
        return;
    }

    currentResults.forEach((place, index) => {
        const photoUrl = place.photos ? place.photos[0].getUrl({ maxWidth: 300, maxHeight: 300 }) : null;
        const dist = place.distanceValue < 1000 ? `${Math.round(place.distanceValue)}m` : `${(place.distanceValue / 1000).toFixed(1)}km`;
        const price = place.price_level ? '$'.repeat(place.price_level) : '價格未知';

        const card = document.createElement('div');
        card.className = 'res-card';
        card.style.animationDelay = `${index * 0.04}s`;
        
        card.innerHTML = `
            <div class="res-img-box">
                ${photoUrl ? `<img src="${photoUrl}" class="res-img">` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#52525b;"><i class="ph-duotone ph-image" style="font-size:3rem;"></i></div>`}
            </div>
            <div class="res-info">
                <h3 class="res-title">${place.name}</h3>
                <div class="res-stats">
                    <div class="stat-item"><i class="ph-fill ph-star star"></i> <span>${place.rating || 'N/A'} <span style="color:var(--text-secondary);font-size:0.8rem">(${place.user_ratings_total || 0})</span></span></div>
                    <div class="stat-item"><i class="ph ph-money"></i> <span>${price}</span></div>
                </div>
                <div class="res-address"><i class="ph ph-map-pin"></i> ${dist} · ${place.vicinity || ''}</div>
            </div>
        `;
        card.addEventListener('click', () => openRestaurantDetails(place.place_id));
        resultsList.appendChild(card);
    });
}

function openRestaurantDetails(placeId) {
    modalBody.innerHTML = '<div style="padding: 4rem; text-align: center; color: var(--text-secondary);"><i class="ph-bold ph-spinner-gap spinner" style="font-size: 2rem;"></i></div>';
    restaurantModal.classList.remove('hidden');

    placesService.getDetails({
        placeId: placeId,
        fields: ['name', 'rating', 'formatted_phone_number', 'formatted_address', 'opening_hours', 'website', 'reviews', 'photos', 'url', 'price_level', 'user_ratings_total']
    }, (place, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK) renderModalDetails(place);
        else modalBody.innerHTML = '<div style="padding:4rem;text-align:center;">載入失敗 😔</div>';
    });
}

function renderModalDetails(place) {
    const photoUrl = place.photos ? place.photos[0].getUrl({ maxWidth: 800, maxHeight: 600 }) : '';
    const isOpen = place.opening_hours ? place.opening_hours.isOpen() : null;
    const openTag = isOpen !== null ? `<div class="tag ${isOpen ? 'open' : 'closed'}"><i class="ph-fill ph-clock"></i> ${isOpen ? '營業中' : '休息中'}</div>` : '';

    let reviewsHtml = place.reviews ? place.reviews.map(r => `
        <div class="review-item">
            <div class="reviewer">
                <img src="${r.profile_photo_url || 'https://via.placeholder.com/40'}" alt="">
                <div class="reviewer-info">
                    <div class="reviewer-name">${r.author_name}</div>
                    <div style="color:var(--star);font-size:0.8rem">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div>
                </div>
                <div class="reviewer-time" style="margin-left:auto">${r.relative_time_description}</div>
            </div>
            <div class="review-text">${r.text}</div>
        </div>
    `).join('') : '<p style="color:var(--text-secondary)">目前無評論。</p>';

    modalBody.innerHTML = `
        ${photoUrl ? `<img src="${photoUrl}" class="detail-hero">` : ''}
        <div class="detail-body">
            <h2 class="detail-title">${place.name}</h2>
            <div class="detail-tags">
                ${openTag}
                <div class="tag"><i class="ph-fill ph-star" style="color:var(--star)"></i> ${place.rating || '-'} (${place.user_ratings_total || 0})</div>
                ${place.price_level ? `<div class="tag"><i class="ph ph-money"></i> ${'$'.repeat(place.price_level)}</div>` : ''}
            </div>
            
            <div class="info-rows">
                <div class="info-row"><i class="ph-fill ph-map-pin"></i> <span>${place.formatted_address || '無地址資訊'}</span></div>
                ${place.formatted_phone_number ? `<div class="info-row"><i class="ph-fill ph-phone"></i> <span>${place.formatted_phone_number}</span></div>` : ''}
            </div>
            
            <div class="action-links">
                <a href="${place.url}" target="_blank" class="btn-outline accent"><i class="ph-fill ph-map-trifold"></i> Google Map 開啟</a>
                ${place.website ? `<a href="${place.website}" target="_blank" class="btn-outline"><i class="ph-fill ph-globe"></i> 餐廳網站 (菜單)</a>` : ''}
            </div>
            
            <div class="reviews-section">
                <h3><i class="ph-fill ph-chats-teardrop"></i> 近期評論</h3>
                ${reviewsHtml}
            </div>
        </div>
    `;
}

closeModalBtn.addEventListener('click', () => restaurantModal.classList.add('hidden'));
restaurantModal.addEventListener('click', (e) => { if (e.target.classList.contains('modal-backdrop')) restaurantModal.classList.add('hidden'); });

function displayEmptyState(msg) {
    resultsList.innerHTML = `<div class="empty-state"><div class="empty-illustration"><i class="ph-duotone ph-magnifying-glass"></i></div><h3>找不到餐廳</h3><p>${msg}</p></div>`;
    resultsCount.textContent = '0';
}

function toggleLoading(isLoading) {
    const icon = searchBtn.querySelector('.btn-icon');
    const spinner = searchBtn.querySelector('.spinner');
    if (isLoading) {
        icon.classList.add('hidden');
        spinner.classList.remove('hidden');
        searchBtn.disabled = true;
    } else {
        icon.classList.remove('hidden');
        spinner.classList.add('hidden');
        searchBtn.disabled = false;
    }
}
