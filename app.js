let map;
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

document.addEventListener('DOMContentLoaded', initApp);

// Initialize App
function initApp() {
    try {
        // Init Leaflet map (currently hidden in UI, but ready if needed)
        map = L.map('map').setView([25.0330, 121.5654], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        setupCustomAutocomplete();
        setupGeolocation();
    } catch (e) {
        console.error("Map 初始化失敗:", e);
    }

    searchBtn.addEventListener('click', performSearch);
}

// Custom Autocomplete using Photon API (Better for partial text / typeahead)
function setupCustomAutocomplete() {
    let debounceTimer;
    
    addressInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = addressInput.value.trim();
        
        if (query.length < 2) {
            suggestionsBox.classList.add('hidden');
            return;
        }

        // 使用企業級的 Esri ArcGIS API 來取代 Photon，對台灣當地地址有極致完美的解析能力
        debounceTimer = setTimeout(async () => {
            try {
                const res = await fetch(`https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/suggest?f=json&text=${encodeURIComponent(query)}&countryCode=TW&maxSuggestions=5`);
                const data = await res.json();
                
                if (!data.suggestions) {
                    renderSuggestions([]);
                    return;
                }

                // ArcGIS 整理成建議清單
                const predictions = data.suggestions.map(s => {
                    const parts = s.text.split(', ');
                    return {
                        display_name: s.text,
                        magicKey: s.magicKey,
                        main_text: parts[0] || s.text,
                        sub_text: parts.slice(1).join(', ') || '台灣'
                    };
                });
                
                renderSuggestions(predictions);
            } catch (err) {
                console.error('Autocomplete Error:', err);
                suggestionsBox.classList.add('hidden');
            }
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
    
    if (predictions.length === 0) {
        suggestionsBox.classList.add('hidden');
        return;
    }
    
    suggestionsBox.classList.remove('hidden');

    predictions.forEach(prediction => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        
        item.innerHTML = `
            <i class="ph ph-map-pin"></i>
            <div>
                <span class="main-text">${prediction.main_text}</span>
                <span class="sub-text">${prediction.sub_text}</span>
            </div>
        `;
        item.addEventListener('click', async () => {
            addressInput.value = prediction.display_name;
            suggestionsBox.classList.add('hidden');
            addressInput.dataset.lastQuery = '';
            addressInput.dataset.magicKey = prediction.magicKey;
            
            // 提早為使用者進行座標轉換，讓他點擊搜尋時不必再等
            try {
                const res = await fetch(`https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&magicKey=${prediction.magicKey}&maxLocations=1`);
                const locData = await res.json();
                if (locData.candidates && locData.candidates.length > 0) {
                    currentSearchLocation = {
                        lat: locData.candidates[0].location.y,
                        lng: locData.candidates[0].location.x
                    };
                    addressInput.dataset.lastQuery = prediction.display_name;
                }
            } catch (e) {
                console.error("ArcGIS 取座標失敗", e);
            }
        });
        suggestionsBox.appendChild(item);
    });
}

function setupGeolocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            currentSearchLocation = { lat, lng };
            // 保留取得作標作為中心基準，但根據要求不再幫使用者將地址文字填入欄位
        });
    }
}

async function performSearch() {
    const query = addressInput.value.trim();
    if (!query && !currentSearchLocation) {
        alert('請先輸入地址或允許取得目前位置！');
        return;
    }

    toggleLoading(true);

    try {
        // 使用 ArcGIS 進行地理編碼，它不需要加縣市名稱就能精準解析 "瑞湖街58號" 等模糊台灣門牌
        if (query && (!currentSearchLocation || query !== addressInput.dataset.lastQuery)) {
            const geocodeUrl = addressInput.dataset.magicKey && query === addressInput.value 
                ? `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&magicKey=${addressInput.dataset.magicKey}&maxLocations=1`
                : `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&singleLine=${encodeURIComponent(query)}&countryCode=TW&maxLocations=1`;

            const res = await fetch(geocodeUrl);
            const data = await res.json();

            if (data.candidates && data.candidates.length > 0) {
                currentSearchLocation = { 
                    lat: data.candidates[0].location.y, 
                    lng: data.candidates[0].location.x 
                };
                addressInput.dataset.lastQuery = query;
            } else {
                toggleLoading(false);
                alert(`查無此地點的地理座標，請嘗試加上縣市區域！`);
                return;
            }
        }

        executePlacesSearch();
    } catch (e) {
        console.error("搜尋發生錯誤:", e);
        toggleLoading(false);
        alert('解析地址時發生非預期錯誤。');
    }
}

// 根據地點的 ID 產生固定的假資料（確保每次搜尋同一家店的評分跟消費不會一直變）
function getConsistentMockData(nodeId) {
    let seed = nodeId || 12345;
    const random = () => {
        let x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
    };
    
    const rating = (3.5 + random() * 1.4).toFixed(1);
    const userRatingsTotal = Math.floor(random() * 800) + 20;
    const priceLevel = Math.floor(random() * 4) + 1;
    
    return { rating: Number(rating), userRatingsTotal, priceLevel };
}

// Haversine formula: 兩點經緯度計算法 (替換掉 Google Geometry)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // metres
    const rad = Math.PI / 180;
    const phi1 = lat1 * rad;
    const phi2 = lat2 * rad;
    const deltaPhi = (lat2 - lat1) * rad;
    const deltaLambda = (lon2 - lon1) * rad;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function executePlacesSearch() {
    const type = foodTypeSelect.value;
    const maxLevel = PRICE_MAP[priceRange.value].level;

    // Mapping category to Overpass logic
    let amenityFilter = '["amenity"="restaurant"]';
    if (type === 'cafe') amenityFilter = '["amenity"="cafe"]';
    if (type === 'bar') amenityFilter = '["amenity"="bar"]';
    if (type === 'vegetarian_restaurant') amenityFilter = '["diet:vegetarian"="yes"]';

    let cuisineFilter = '';
    const cuisineMap = {
        'taiwanese_restaurant': 'taiwanese',
        'japanese_restaurant': 'japanese',
        'korean_restaurant': 'korean',
        'italian_restaurant': 'italian',
        'american_restaurant': 'american|burger'
    };
    if (cuisineMap[type]) cuisineFilter = `["cuisine"~"${cuisineMap[type]}"]`;

    // Overpass Query
    const overpassQuery = `
        [out:json];
        (
          node${amenityFilter}${cuisineFilter}(around:3000, ${currentSearchLocation.lat}, ${currentSearchLocation.lng});
        );
        out 40;
    `;
    
    try {
        const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;
        const res = await fetch(url);
        const data = await res.json();
        
        toggleLoading(false);
        const elements = data.elements || [];

        if (elements.length > 0) {
            // Transform OSM nodes into internal format
            currentResults = elements.filter(node => node.tags && node.tags.name).map(node => {
                const mock = getConsistentMockData(node.id);
                return {
                    place_id: node.id,
                    name: node.tags.name,
                    lat: node.lat,
                    lng: node.lon,
                    rating: mock.rating,
                    user_ratings_total: mock.userRatingsTotal,
                    price_level: mock.priceLevel,
                    vicinity: node.tags['addr:street'] ? `${node.tags['addr:city'] || ''}${node.tags['addr:street']}` : '地址未登錄',
                    website: node.tags.website || null,
                    phone: node.tags.phone || null,
                    tags: node.tags
                };
            });

            // Filter by price level
            currentResults = currentResults.filter(place => place.price_level <= maxLevel);

            currentResults.forEach(r => {
                r.distanceValue = calculateDistance(currentSearchLocation.lat, currentSearchLocation.lng, r.lat, r.lng);
            });
            
            sortAndDisplayResults();
        } else {
            displayEmptyState('找不到符合條件的餐廳。');
        }
    } catch (e) {
        console.error("Overpass API 錯誤:", e);
        toggleLoading(false);
        displayEmptyState('查詢周邊資料時發生錯誤，因為免費開源 API 可能有點塞車，請稍後再試。');
    }
}

function sortAndDisplayResults() {
    const sortBy = sortBySelect.value;
    currentResults.sort((a, b) => {
        if (sortBy === 'rating') {
            if (a.rating !== b.rating) return b.rating - a.rating;
            return b.user_ratings_total - a.user_ratings_total;
        } else if (sortBy === 'distance') {
            return a.distanceValue - b.distanceValue;
        } else {
            return 0; // Prominence 這裡預設無特別邏輯，就不排序
        }
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
        // 為了確保圖片是「食物/餐廳」類型，改用 LoremFlickr 並加上標籤限制，維持隨機但都是真實食物照
        const safeLockId = (typeof place.place_id === 'number' ? place.place_id : parseInt(place.place_id, 10)) % 10000;
        const photoUrl = `https://loremflickr.com/400/300/food,restaurant,dish?lock=${safeLockId}`;
        const dist = place.distanceValue < 1000 ? `${Math.round(place.distanceValue)}m` : `${(place.distanceValue / 1000).toFixed(1)}km`;
        
        const priceRanges = { 1: 'NT$200 以下', 2: 'NT$200 - 500', 3: 'NT$500 - 1500', 4: 'NT$1500 以上' };
        const price = priceRanges[place.price_level] || '未知價格';

        const card = document.createElement('div');
        card.className = 'res-card';
        card.style.animationDelay = `${index * 0.04}s`;
        
        card.innerHTML = `
            <div class="res-img-box">
                <img src="${photoUrl}" class="res-img" loading="lazy" alt="Restaurant Image">
            </div>
            <div class="res-info">
                <h3 class="res-title">${place.name}</h3>
                <div class="res-stats">
                    <div class="stat-item"><i class="ph-fill ph-star star"></i> <span>${place.rating} <span style="color:var(--text-secondary);font-size:0.8rem">(${place.user_ratings_total})</span></span></div>
                    <div class="stat-item"><i class="ph ph-money"></i> <span>${price}</span></div>
                </div>
                <div class="res-address"><i class="ph ph-map-pin"></i> ${dist} · ${place.vicinity}</div>
            </div>
        `;
        card.addEventListener('click', () => openRestaurantDetails(place));
        resultsList.appendChild(card);
    });
}

function openRestaurantDetails(place) {
    modalBody.innerHTML = '<div style="padding: 4rem; text-align: center; color: var(--text-secondary);"><i class="ph-bold ph-spinner-gap spinner" style="font-size: 2rem;"></i></div>';
    restaurantModal.classList.remove('hidden');

    // 模擬載入細節的延遲，讓畫面感覺有在跑 API
    setTimeout(() => {
        renderModalDetails(place);
    }, 400);
}

function renderModalDetails(place) {
    const safeLockId = (typeof place.place_id === 'number' ? place.place_id : parseInt(place.place_id, 10)) % 10000;
    const photoUrl = `https://loremflickr.com/800/600/food,restaurant,dish?lock=${safeLockId}`;
    const openTag = `<div class="tag open"><i class="ph-fill ph-clock"></i> 營業中 (模擬)</div>`;
    const priceRanges = { 1: 'NT$200 以下', 2: 'NT$200 - 500', 3: 'NT$500 - 1500', 4: 'NT$1500 以上' };

    modalBody.innerHTML = `
        <img src="${photoUrl}" class="detail-hero" alt="Hero Image">
        <div class="detail-body">
            <h2 class="detail-title">${place.name}</h2>
            <div class="detail-tags">
                ${openTag}
                <div class="tag"><i class="ph-fill ph-star" style="color:var(--star)"></i> ${place.rating} (${place.user_ratings_total})</div>
                <div class="tag"><i class="ph ph-money"></i> ${priceRanges[place.price_level] || '未知價格'}</div>
            </div>
            
            <div class="info-rows">
                <div class="info-row"><i class="ph-fill ph-map-pin"></i> <span>${place.vicinity}</span></div>
                ${place.phone ? `<div class="info-row"><i class="ph-fill ph-phone"></i> <span>${place.phone}</span></div>` : ''}
            </div>
            
            <div class="action-links">
                <a href="https://www.openstreetmap.org/node/${place.place_id}" target="_blank" class="btn-outline accent"><i class="ph-fill ph-map-trifold"></i> 在 OSM 地圖中開啟</a>
                ${place.website ? `<a href="${place.website}" target="_blank" class="btn-outline"><i class="ph-fill ph-globe"></i> 餐廳網站</a>` : ''}
            </div>
            
            <div class="reviews-section">
                <h3><i class="ph-fill ph-chats-teardrop"></i> 近期評論 (模擬資料)</h3>
                <div class="review-item">
                    <div class="reviewer">
                        <img src="https://ui-avatars.com/api/?name=User&background=random" alt="">
                        <div class="reviewer-info">
                            <div class="reviewer-name">美食探險家</div>
                            <div style="color:var(--star);font-size:0.8rem">★★★★☆</div>
                        </div>
                        <div class="reviewer-time" style="margin-left:auto">1 週前</div>
                    </div>
                    <div class="review-text">因為轉用開源資料庫，評分機制是我寫好的模擬資料，這是一間在地的神祕好店！推薦大家親自去試看這家店到底好不好吃！</div>
                </div>
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
