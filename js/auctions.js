const minTransactionPrice = 10000
let markers = {};


// Function to load CSV file using PapaParse
function loadCSV(url, dateKey = "auction_date") {
    return new Promise((resolve, reject) => {
        Papa.parse(url, {
            download: true,
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true,
            complete: results => {
                if (dateKey) {
                    // Convert "SALE DATE" property to JavaScript Date objects
                    results.data = results.data.map(obj => {
                        // Use destructuring to get other properties if needed
                        const { [dateKey]: saleDate, ...rest } = obj;

                        // Convert string to Date, set to midnight (otherwise date filter doesn't work)
                        const saleDateObj = new Date(saleDate);
                        saleDateObj.setHours(24, 0, 0, 0)

                        // Add other properties back if needed
                        return { [dateKey]: saleDateObj, ...rest };
                    });
                }
                resolve(results.data);
            },
            error: error => {
                reject(error.message);
            }
        });
    });
}
let combinedData = []


function updateURLWithFilters(filters) {
    const params = new URLSearchParams();

    Object.keys(filters).forEach(column => {
        params.set(column, JSON.stringify(filters[column]));
    });

    // Update the URL in the address bar
    window.history.replaceState({}, '', `${window.location.pathname}?${params}`);
}

// Create a custom control for the button
const clearTableFilter = L.Control.extend({
    options: {
      position: 'bottomright'
    },
    onAdd: function (map) {
      const container = L.DomUtil.create('button');
      container.innerHTML = 'Clear Filters';
      container.onclick = function () {
        // Update the URL in the address bar to remove all filters
        window.history.replaceState({}, '', `${window.location.pathname}`);
        applyFiltersFromURL();
      }
      return container;
    }
  });


function applyFiltersFromURL() {
    const params = new URLSearchParams(window.location.search);
    if (params.size == 0) {
        const currentDate = new Date();
        const futureDate = new Date();
        futureDate.setDate(currentDate.getDate() + 7);
        gridApi.setColumnFilterModel('auction_date', {
            dateFrom: currentDate.toISOString(),
            dateTo: futureDate.toISOString(),
            filterType: "auction_date",
            type: "inRange"
        })
        gridApi.onFilterChanged()
        return
    }
    const filters = {};

    params.forEach((value, key) => {
        filters[key] = JSON.parse(value);
    });

    gridApi.setFilterModel(filters);
}



// grid columns
const columnDefs = [
    {
        headerName: "Sold?",
        field: "isSold",
        cellDataType: 'boolean',
        filter: 'agSetColumnFilter',
        // suppressSizeToFit: true,
        // resizeable: false,
        maxWidth: 75,
    },
    {
        field: "borough",
        filter: 'agSetColumnFilter',
        maxWidth: 150,
    },
    {
        headerName: "Address",
        field: "address",
        cellRenderer: 'agGroupCellRenderer',
        minWidth: 200,
    },
    {
        headerName: "Case #",
        field: "case_number",
        cellRenderer: function (params) {
            const filename = 'saledocs/noticeofsale/' + params.value.replace('/', '-') + '.pdf'
            return `<a href="${filename}" target="_blank">` + params.value + '</a>'
        }
    },
    {
        headerName: "Auction Date",
        field: "auction_date",
        suppressSizeToFit: true,
        minWidth: 120,
        filter: 'agDateColumnFilter',
        sort: "asc",
        sortIndex: 0,
    },
    // {
    //     headerName: "Block", field: "block", type: "rightAligned",
    //     filter: 'agNumberColumnFilter',
    //     maxWidth: 100,
    // },
    // {
    //     headerName: "Lot", field: "lot", type: "rightAligned",
    //     filter: 'agNumberColumnFilter',
    //     maxWidth: 100,
    // },
    {
        headerName: "BBL", 
        type: "rightAligned",
        valueGetter: p => `${p.data.block}-${p.data.lot}`,
        maxWidth: 100,
    },
    // {
    //     headerName: "Judgement Amt", field: "judgement",
    //     valueFormatter: (params) => params.value ? formattedCurrency.format(params.value) : null,
    // },
    {
        headerName: "Upset Price", field: "upset_price", type: ["currency", "rightAligned"],
        // valueFormatter: (params) => params.value || params.value == "" ? formattedCurrency.format(params.value) : null
    },
    {
        headerName: "Sale Price", field: "winning_bid", type: ["currency", "rightAligned"],
        // valueFormatter: (params) => params.value ? formattedCurrency.format(params.value) : null,
        cellRenderer: function (params) {
            if (params.value || params.value == "") {
                const filename = 'saledocs/surplusmoney/' + params.data.case_number.replace('/', '-') + '.pdf'
                return `<a href="${filename}" target="_blank">` + formattedCurrency.format(params.value) + '</a>'
            }
        }
    }

]

const formattedCurrency = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
});


const formattedPercent = new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
})


const defaultColDef = {
    flex: 1,
    minWidth: 100,
    filter: 'agTextColumnFilter',
    menuTabs: ['filterMenuTab'],
    autoHeaderHeight: true,
    wrapHeaderText: true,
    suppressHeaderMenuButton: true,
    sortable: true,
    resizable: true
}

function zoomToBlock(event) {
    if (!event.node.isSelected()) {
        return
    }


    let borough = borough_code_dict[event.node.data.borough]; // Example: Manhattan
    let block = event.node.data.block;
    let lot = event.node.data.lot;
    const key = `${borough}-${block}-${lot}`;
    map.fitBounds(markers[key][0].getBounds(), { maxZoom: 17 })

}


function getCondoBillingLot(data) {
    const { block, lot, borough } = data;
    // boro is either 1,2,3,4,5 (1 == Manhattan)
    const boro = Object.entries(borough_dict).find(([id, boro]) => boro === borough)[0]

    const serviceUrl = `https://services6.arcgis.com/yG5s3afENB5iO9fj/arcgis/rest/services/DTM_ETL_DAILY_view/FeatureServer`;
    const condoUrl = `${serviceUrl}/3`
    const condoUnitUrl = `${serviceUrl}/4`

    const condoUnitQuery = L.esri.query({ url: condoUnitUrl })

    condoUnitQuery
        .where(`UNIT_BORO = ${boro} and UNIT_BLOCK=${block} and UNIT_LOT=${lot}`)
        .fields(['CONDO_BASE_BBL_KEY'])
        .returnGeometry(false)
        .limit(1)
        .run((error, featureCollection, response) => {
            if (error) {
                console.error("Error during the condo unit query:", error)
                return
            }

            if (!featureCollection.features.length) {
                console.log("No data found for the input in CONDO_UNIT table", boro, block, lot)
                data.billingLot = 7501
                return
            }

            const condoBaseBblKey = featureCollection.features[0].properties.CONDO_BASE_BBL_KEY

            const condoQuery = L.esri.query({ url: condoUrl })

            condoQuery
                .where(`CONDO_BASE_BBL_KEY = ${condoBaseBblKey}`)
                .fields(['CONDO_BILLING_BBL'])
                .returnGeometry(false)
                .limit(1)
                .run((error, featureCollection, response) => {
                    if (error) {
                        console.error("Error during the condo query:", error)
                        return
                    }

                    if (!featureCollection.features.length) {
                        console.log("No data found for the input in CONDO table", condoBaseBblKey, boro, block, lot)
                        return
                    }

                    const condoBillingLotStr = featureCollection.features[0].properties.CONDO_BILLING_BBL
                    const condoBillingLot = parseInt(condoBillingLotStr.slice(6, 10))
                    data.billingLot = condoBillingLot
                })


        })
}




function onGridFilterChanged() {
    const allFilters = gridApi.getFilterModel()
    updateURLWithFilters(allFilters);

    // Get all displayed rows
    gridApi.forEachNodeAfterFilterAndSort(({ data }) => {
        if (!data.block || !data.borough || !data.lot) {
            return
        }
        const boroughCode = borough_code_dict[data.borough]
        const lot = data.lot > 1000 ? (data.billingLot ?? 7501) : data.lot


        const onClickTableZoom = () => {
            // Highlight the row in AG Grid
            gridApi.forEachNodeAfterFilterAndSort(function (node) {
                if (node.data.borough === data.borough && node.data.block === data.block && node.data.lot === data.lot) {
                    node.setSelected(true, true); // Select the row

                    // Ensure the selected row is visible by scrolling to it
                    gridApi.ensureIndexVisible(node.rowIndex, 'middle');
                }
            });
        }
        
        blockLotLayer.query()
            .where(`Borough = '${boroughCode}' AND Block = ${data.block} AND Lot = ${lot}`)
            .run((error, featureCollection) => {
                if (error) {
                    console.error("Couldn't find geometry for BBL", boroughCode, data.block, lot, error);
                    return;
                }

                if (featureCollection.features.length == 0) {
                    console.warn("failed to return any results", boroughCode, data.block, lot)
                    return;
                }
        
                const layer = L.geoJSON(featureCollection, {
                    onEachFeature: function (feature, layer) {
                        layer.on('click', onClickTableZoom)
                    }
                }).addTo(map);

                const centroid = getCentroid(featureCollection.features[0].geometry)
                const marker = L.marker([centroid.lng, centroid.lat]).addTo(markerLayer);
                marker.on('click', onClickTableZoom)

                // Store the marker in the markers object
                const key = `${boroughCode}-${data.block}-${data.lot}`;
                if (!markers[key]) {
                    markers[key] = []
                }
                markers[key].push(layer);
                
            });
    });
}

// Initialize AG Grid
const gridOptions = {
    columnDefs: columnDefs,
    defaultColDef: defaultColDef,
    masterDetail: true,
    isRowMaster: (dataItem) => {
        return dataItem ? getTransactions(dataItem).length : false;
    },
    detailRowAutoHeight: true,
    rowSelection: { 
        mode: 'singleRow',
        checkboxes: false,
        enableClickSelection: true,
    },
    onRowSelected: zoomToBlock,
    // Listen for AG Grid filter changes
    onFilterChanged: onGridFilterChanged,

    columnTypes: {
        currency: {
            width: 150,
            valueFormatter: ({ value }) => value ? formattedCurrency.format(value) : value,
            filter: 'agNumberColumnFilter',
        },
    },

    detailCellRendererParams: {
        detailGridOptions: {
            columnDefs: [
                {
                    headerName: "Address", field: "ADDRESS",
                    minWidth: 200,
                },
                {
                    headerName: "Neighborhood", field: "NEIGHBORHOOD",
                    filter: 'agSetColumnFilter'
                },
                {
                    headerName: "Category", field: "BUILDING CLASS CATEGORY",
                },
                {
                    headerName: "Apt #", field: "APARTMENT NUMBER",
                },
                {
                    headerName: "Total Units", field: "TOTAL UNITS",
                    filter: 'agNumberColumnFilter',
                },
                {
                    field: 'SALE DATE',
                    headerName: 'Sale Date',
                    filter: 'agDateColumnFilter',
                    sort: "asc",
                    sortIndex: 0,
                    sortable: true
                },
                {
                    headerName: 'Sale Price',
                    field: "SALE PRICE",
                    valueFormatter: (params) => formattedCurrency.format(params.value),
                },

            ],
            defaultColDef: {
                flex: 1,
                sortable: true,
                filter: 'agNumberColumnFilter',
            },
        },
        getDetailRowData: (params) => {
            // find all transactions for this address
            let repeats = getTransactions(params.data);


            // add % price change
            repeats = repeats.map((transaction, index, arr) => {
                // For the first row, priceChange is null
                if (index === 0) {
                    return { ...transaction, priceChange: null };
                }

                // For subsequent rows, priceChange is the difference in price over the immediately preceding sale
                const priceChange = transaction["SALE PRICE"] - arr[index - 1]["SALE PRICE"];
                const priceChangePct = transaction["SALE PRICE"] / arr[index - 1]["SALE PRICE"] - 1;
                return { ...transaction, priceChange, priceChangePct };
            });

            params.successCallback(repeats);
        },
    },

};

// Create AG Grid
const gridDiv = document.querySelector('#myGrid');
const gridApi = agGrid.createGrid(gridDiv, gridOptions)


const csvPromises = [
    loadCSV('foreclosures/auction_sales.csv', 'SALE DATE'),
    loadCSV('foreclosures/cases.csv', dateKey = 'auction_date'),
    loadCSV('foreclosures/lots.csv', dateKey = null),
    loadCSV('foreclosures/bids.csv', dateKey = 'auction_date')
]

// Use Promise.all to wait for all promises to resolve
Promise.all(csvPromises).then(([sales, auctions, lots, bids]) => {
    combinedData = sales
    // get the address from transaction records
    for (const lot of lots) {
        const auctionMatches = auctions.filter(({ case_number }) => case_number == lot.case_number)
        if (!auctionMatches.length) {
            console.log("Couldn't find a match for lot", lot.case_number)
            continue
        }

        const auction = auctionMatches[0]
        lot.auction_date = auction.auction_date
        lot.case_name = auction.case_name
        if (lot.lot > 1000) {
            getCondoBillingLot(lot)
        }


        const result = bids.find(({ case_number, auction_date }) => (case_number == lot.case_number) && (auction_date.getTime() == lot.auction_date.getTime()))
        if (result) {
            lot.judgement = result.judgement
            lot.upset_price = result.upset_price
            lot.winning_bid = result.winning_bid
        }

        const transactions = getTransactions(lot)

        if (transactions.length > 0) {
            if (!lot.address) {
                lot.address = transactions[transactions.length - 1]["ADDRESS"]
            }
            lot.isSold = new Date() > lot.auction_date ? transactions.some(t => {
                const millisecondsInADay = 24 * 60 * 60 * 1000;
                const dayDifference = (t["SALE DATE"] - lot.auction_date) / millisecondsInADay
                return dayDifference >= 0 && dayDifference <= 90 && t["SALE PRICE"] > minTransactionPrice
            }) : false
        } else {
            lot.isSold = false
        }
    }


    // load the full table
    gridApi.setGridOption('rowData', lots)
    gridApi.sizeColumnsToFit()
    // Load and apply filters from URL when the grid initializes (have to wait till now so that table isn't empty)
    applyFiltersFromURL(gridApi);
})
    .catch(error => {
        console.error('Error loading CSV files:', error);
    });


function getTransactions(data) {
    let repeats = combinedData.filter(({ BOROUGH, BLOCK, LOT, "SALE PRICE": SALE_PRICE }) => BOROUGH == data.borough && BLOCK == data.block && LOT == data.lot && SALE_PRICE > minTransactionPrice);
    repeats.sort((a, b) => a["SALE DATE"] - b["SALE DATE"]);
    return repeats;
}

// Style URL format in XYZ PNG format; see our documentation for more options
const toner = L.tileLayer('https://tiles.stadiamaps.com/tiles/stamen_toner/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    attribution: '&copy; <a href="https://stadiamaps.com/" target="_blank">Stadia Maps</a>, &copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
});


const map = L.map('map', {
    center: [40.7143, -74.0060],
    zoom: 13,
    layers: [toner]
})
const layerControl = L.control.layers({ "Streets": toner }).addTo(map);

const blockLotLayer = L.esri.featureLayer({
    url: 'https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services/MAPPLUTO/FeatureServer/0',
    where: "1 = 0"
}).addTo(map);

const markerLayer = L.layerGroup().addTo(map);

// Add the custom control to the map
map.addControl(new clearTableFilter());

// Function to calculate the centroid of a GeoJSON geometry
function getCentroid(geometry) {
    let latlng = [];

    switch (geometry.type) {
        case 'Polygon':
            latlng = L.polygon(geometry.coordinates).getBounds().getCenter();
            break;
        case 'MultiPolygon':
            latlng = L.polygon(geometry.coordinates[0]).getBounds().getCenter();
            break;
        case 'Point':
            latlng = L.latLng(geometry.coordinates[1], geometry.coordinates[0]);
            break;
        default:
            console.error('Unsupported geometry type:', geometry.type);
            break;
    }
    return latlng;
}

const borough_dict = {
    "1": "Manhattan",
    "2": "Bronx",
    "3": "Brooklyn",
    "4": "Queens",
    "5": "Staten Island",
}

const borough_code_dict = {
    "Manhattan": "MN",
    "Bronx": "BX",
    "Brooklyn": "BK",
    "Queens": "QN",
    "Staten Island": "SI",
}



// splitter functionality
const splitter = document.getElementById('splitter')

let isResizing = false
const mapDiv = document.getElementById('map')

splitter.addEventListener('mousedown', startResize())
document.addEventListener('mousemove', resize())
document.addEventListener('mouseup', stopResize())

splitter.addEventListener('touchstart', startResize())
document.addEventListener('touchmove', resize())
document.addEventListener('touchend', stopResize())

function stopResize() {
    return () => {
        isResizing = false;
    };
}

function resize() {
    return (e) => {
        if (!isResizing) return;
        const lastY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
        const newMapHeight = lastY;
        const newGridHeight = window.innerHeight - lastY - splitter.offsetHeight;

        mapDiv.style.height = newMapHeight + 'px';
        gridDiv.style.height = newGridHeight + 'px';
        map.invalidateSize();
        gridApi.sizeColumnsToFit();

    };
}

function startResize() {
    return (e) => {
        isResizing = true;
    };
}

