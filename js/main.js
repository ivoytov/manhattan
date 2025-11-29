const SQL_JS_VERSION = "1.9.0";
const SQL_JS_BASE_URL = `https://cdnjs.cloudflare.com/ajax/libs/sql.js/${SQL_JS_VERSION}`;
const DATABASE_PATH = "data/nyc_data.sqlite";

let outliers = []
let combinedData = []

const databasePromise = initSqlJs({
  locateFile: (file) => `${SQL_JS_BASE_URL}/${file}`,
}).then(async (SQL) => {
  const response = await fetch(DATABASE_PATH);
  if (!response.ok) {
    throw new Error(`Failed to load SQLite database (${DATABASE_PATH}): ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  return new SQL.Database(new Uint8Array(buffer));
});

function runQuery(db, sql) {
  const [result] = db.exec(sql);
  if (!result) {
    return [];
  }

  const { columns, values } = result;
  return values.map((row) => {
    const record = {};
    columns.forEach((column, index) => {
      record[column] = row[index];
    });
    return record;
  });
}

function parseSaleDate(value) {
  const saleDate = new Date(value);
  saleDate.setHours(24, 0, 0, 0);
  return saleDate;
}

const is_outlier = (obj) => !outliers.some(outlier => outlier.lot === obj.LOT && outlier.block === obj.BLOCK && outlier["SALE DATE"].getTime() === obj["SALE DATE"].getTime() && outlier.sale_price === obj["SALE PRICE"])

async function loadOutliers(db) {
  const rows = runQuery(db, 'SELECT block, lot, "SALE DATE", sale_price FROM transactions_outliers');
  return rows.map((row) => ({
    ...row,
    "SALE DATE": parseSaleDate(row["SALE DATE"]),
  }));
}

async function loadTransactions(db) {
  qry = `
    select 
    d.id as borough_id, 
    d.borough, 
    block, 
    lot, 
    address, 
    [APARTMENT NUMBER], 
    [ZIP CODE], [RESIDENTIAL UNITS], [COMMERCIAL UNITS], [TOTAL UNITS], [LAND SQUARE FEET], [YEAR BUILT], [SALE PRICE], [SALE DATE], neighborhood, building_class_category
  from transactions 
  join neighborhoods b on neighborhood_id = b.id 
  join building_class_categories c on building_class_category_id = c.id 
  join boroughs d on d.id = transactions.borough  
  order by "SALE DATE" desc`
  const rows = runQuery(db, qry);
  return rows.map((row) => ({
    ...row,
    "SALE DATE": parseSaleDate(row["SALE DATE"]),
  }));
}

async function loadHomePriceIndex(db) {
  return runQuery(db, "SELECT * FROM home_price_index ORDER BY period").map((row) => ({
    ...row,
    period: parseSaleDate(row.period),
  }));
}

async function loadHomePriceSubindex(db) {
  qry = `
  SELECT period, borough, house_class, home_price_index
FROM home_price_subindex a
 join boroughs b on b.id = a.borough_id 
 join house_classes c on c.id = a.house_class_id
ORDER BY period;`
  return runQuery(db, qry).map((row) => ({
    ...row,
    period: parseSaleDate(row.period),
  }));
}

async function loadHomePriceNeighborhoods(db) {
  qry = `
  SELECT period, borough, neighborhood, home_price_index
FROM home_price_neighborhoods a
join boroughs b on b.id = a.borough_id
join neighborhoods c on c.id = a.neighborhood_id
ORDER BY period;`
  return runQuery(db, qry).map((row) => ({
    ...row,
    period: parseSaleDate(row.period),
  }));
}

function applyOutlierFlag(rows) {
  return rows.map((row) => ({
    ...row,
    outlier: is_outlier(row),
  }));
}


// Filter model
const defaultFilter = {
  "building_class_category": {
    filterType: 'text',
    type: 'condo',
  },
  "SALE PRICE": {
    filterType: 'number',
    type: 'greaterThan',
    filter: 100000
  }
}

// custom filter for BUILDING CLASS CATEGORY for SFH, Coops, Condos, Other
const houseClassFilterParams = {
  filterOptions: [
    'contains',
    {
      displayKey: 'condo',
      displayName: 'Condo',
      predicate: (_, cellValue) =>
        cellValue.slice(0, 2) == "12" || cellValue.slice(0, 2) == "13",
      numberOfInputs: 0,
    },
    {
      displayKey: 'Coop',
      displayName: 'Coop',
      predicate: (_, cellValue) =>
        cellValue.slice(0, 2) == "09" || cellValue.slice(0, 2) == "17",
      numberOfInputs: 0,
    },
    {
      displayKey: 'sfh',
      displayName: 'Single Family Home',
      predicate: (_, cellValue) =>
        cellValue.slice(0, 2) == "01",
      numberOfInputs: 0,
    },
    {
      displayKey: 'other',
      displayName: 'All Others',
      predicate: (_, cellValue) => {
        const code = cellValue.slice(0, 2)
        return !["01", "09", "10", "12", "13", "17"].includes(code)
      },
      numberOfInputs: 0,
    },
  ],
};

// grid columns
const columnDefs = [
  {
    headerName: "Is Included?",
    field: "outlier",
    cellDataType: 'boolean',
    filter: 'agSetColumnFilter',
    maxWidth: 100,
  },
  {
    headerName: "Address", field: "ADDRESS", sort: "asc", sortIndex: 1,
    cellRenderer: 'agGroupCellRenderer',
    minWidth: 400,
  },
  {
    headerName: "Sale Date", field: "SALE DATE",
    suppressSizeToFit: true,
    minWidth: 120,
    filter: 'agDateColumnFilter',
    sort: "desc",
    sortIndex: 0
  },
  {
    headerName: "Borough",
    field: "borough",
    filter: 'agSetColumnFilter',
  },
  {
    headerName: "Neighborhood", field: "neighborhood",
    filter: 'agSetColumnFilter'
  },
  {
    headerName: "Category", field: "building_class_category",
    // filterParams: houseClassFilterParams,
  },
  {
    headerName: "BBL",
    type: "rightAligned",
    valueGetter: p => `${p.data.BLOCK}-${p.data.LOT}`,
    maxWidth: 100,
  },
  {
    headerName: "Apt #", field: "APARTMENT NUMBER",
    maxWidth: 100,
  },
  {
    headerName: "Total Units", field: "TOTAL UNITS",
    filter: 'agNumberColumnFilter',
    maxWidth: 100,
  },
  {
    headerName: "Year Built", field: "YEAR BUILT",
    filter: 'agNumberColumnFilter',
    maxWidth: 100,
  },
  {
    headerName: "Sale Price",
    field: "SALE PRICE",
    filter: 'agNumberColumnFilter',
    valueFormatter: (params) => formattedCurrency.format(params.value)
  }
]

const formattedCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const coopsFilter = (row) =>
  row['building_class_category'].startsWith('09')
  || row['building_class_category'].startsWith('10')
  || row['building_class_category'].startsWith('17')

const formattedPercent = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
})

function getTransactions(data) {
  let repeats = coopsFilter(data) ? combinedData.filter(({ ADDRESS }) => ADDRESS == data.ADDRESS)
  : combinedData.filter(({ borough_id, BLOCK, LOT }) => borough_id == data.borough_id && BLOCK == data.BLOCK && LOT == data.LOT)

  // remove erroneous transactions
  repeats = repeats.filter((transaction) => transaction["SALE PRICE"] >= 100000)
  return repeats
} 


const defaultColDef = {
  flex: 1,
  minWidth: 100,
  filter: 'agTextColumnFilter',
  menuTabs: ['filterMenuTab'],
  autoHeaderHeight: true,
  wrapHeaderText: false,
  sortable: true,
  resizable: true,
  suppressHeaderMenuButton: true,
}

// Initialize AG Grid
const gridOptions = {
  columnDefs: columnDefs,
  defaultColDef: defaultColDef,
  masterDetail: true,
  detailRowAutoHeight: true,

  detailCellRendererParams: {
    detailGridOptions: {
      columnDefs: [
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
        {
          headerName: 'Change, $',
          field: "priceChange",
          filter: 'agNumberColumnFilter',
          valueFormatter: (params) => params.value != null ? formattedCurrency.format(params.value) : "N/A",
        },
        {
          headerName: 'Change, %',
          field: "priceChangePct",
          filter: 'agNumberColumnFilter',
          valueFormatter: (params) => params.value != null ? formattedPercent.format(params.value) : "N/A",
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
      let repeats = getTransactions(params.data)
      repeats.sort((a, b) => a["SALE DATE"] - b["SALE DATE"])

     
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

gridApi.setFilterModel(defaultFilter);

async function bootstrap() {
  try {
    const db = await databasePromise;
    // outliers = await loadOutliers(db);
    const transactions = await loadTransactions(db);
    combinedData = applyOutlierFlag(transactions);

    gridApi.setGridOption('rowData', combinedData);
    gridApi.sizeColumnsToFit();

    const [idx, idxb, idxn] = await Promise.all([
      loadHomePriceIndex(db),
      loadHomePriceSubindex(db),
      loadHomePriceNeighborhoods(db)
    ]);

    renderChart(idx, idxb, idxn);
  } catch (error) {
    console.error('Error loading data from SQLite:', error);
  }
}

function renderChart(idx, idxb, idxn) {
  const boroughs = new Set(idxb.map(({ borough }) => borough));
  const houseClasses = new Set(idxb.map(({ house_class }) => house_class));
  const neighborhoods = new Set(idxn.map(({ neighborhood }) => neighborhood));

  const seriesNames = ["NYC", "NYC - Top 10%", "NYC - Top 33%", "NYC - Middle 33%", "NYC - Bottom 33%", "NYC - Bottom 10%"];
  const series = [];

  const makeSeries = (data, name) => ({
    name: name,
    type: 'line',
    symbol: 'none',
    data: data
  });

  for (const borough of boroughs) {
    for (const cls of houseClasses) {
      const data = idxb
        .filter(({ borough: b, house_class: c }) => borough === b && cls === c)
        .map(({ period, home_price_index }) => [period, home_price_index]);
      const name = `${borough} ${cls}`;
      series.push(makeSeries(data, name));
      seriesNames.push(name);
    }
  }

  for (const borough of boroughs) {
    for (const neighborhood of neighborhoods) {
      const data = idxn
        .filter(({ borough: b, neighborhood: n }) => borough === b && neighborhood === n)
        .map(({ period, home_price_index }) => [period, home_price_index]);
      const name = `${borough} ${neighborhood}`;

      if (!data.length) {
        continue;
      }

      series.push(makeSeries(data, name));
      seriesNames.push(name);
    }
  }

  const isSelected = seriesNames.reduce((accumulator, current) => {
    accumulator[current] = false;
    return accumulator;
  }, {});

  isSelected["Manhattan Condo"] = true;
  isSelected["Brooklyn SFH"] = true;
  isSelected["NYC"] = true;
  isSelected["NYC - Top 10%"] = true;

  const option = {
    title: {
      text: 'NYC Repeat Sales Home Price Index'
    },
    dataset: [
      {
        dimensions: [{ name: 'period', type: 'time' }, "top_decile", "top_third", "bottom_decile", "middle_third", "bottom_third", "all"],
        source: idx,
      },
    ],
    tooltip: {
      trigger: 'axis'
    },
    legend: {
      selected: isSelected,
      type: 'scroll',
      orient: 'horizontal',
      data: seriesNames,
      top: 20,
      left: 20,
      right: 20,
      textStyle: {
        width: 75,
        overflow: 'break'

      }
    },
    grid: {
      top: 100
    },
    xAxis: {
      type: 'time'
    },
    yAxis: {
      min: 'dataMin',
    },
    series: [
      {
        name: 'NYC',
        type: 'line',
        symbol: 'none',
        datasetIndex: 0,
        encode: {
          x: 'period',
          y: 'all'
        }
      },
      {
        name: 'NYC - Top 10%',
        type: 'line',
        symbol: 'none',
        datasetIndex: 0,
        encode: {
          x: 'period',
          y: 'top_decile'
        }
      },
      {
        name: 'NYC - Top 33%',
        type: 'line',
        symbol: 'none',
        datasetIndex: 0,
        encode: {
          x: 'period',
          y: 'top_third'
        }
      },
      {
        name: 'NYC - Middle 33%',
        type: 'line',
        symbol: 'none',
        datasetIndex: 0,
        encode: {
          x: 'period',
          y: 'middle_third'
        }
      },
      {
        name: 'NYC - Bottom 33%',
        type: 'line',
        symbol: 'none',
        datasetIndex: 0,
        encode: {
          x: 'period',
          y: 'bottom_third'
        }
      },
      {
        name: 'NYC - Bottom 10%',
        type: 'line',
        symbol: 'none',
        datasetIndex: 0,
        encode: {
          x: 'period',
          y: 'bottom_decile'
        }
      },
      ...series
    ]
  };

  myChart.setOption(option);
}

// Initialize the echarts instance based on the prepared dom
const myChart = echarts.init(document.getElementById('main'));
bootstrap();

// splitter functionality
const splitter = document.getElementById('splitter')

let isResizing = false
const mapDiv = document.getElementById('main')

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
    myChart.resize()
    gridApi.sizeColumnsToFit();

  };
}

function startResize() {
  return (e) => {
    isResizing = true;
  };
}
