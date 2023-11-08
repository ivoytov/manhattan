// Function to load CSV file using PapaParse
function loadCSV(url) {
  return new Promise((resolve, reject) => {
    Papa.parse(url, {
      download: true,
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: results => {
        // Convert "SALE DATE" property to JavaScript Date objects
        results.data = results.data.map(obj => {
          const dateKey = "SALE DATE" in obj ? "SALE DATE" : "period"

          // Use destructuring to get other properties if needed
          const { [dateKey]: saleDate, ...rest } = obj;

          // Convert string to Date, set to midnight (otherwise date filter doesn't work)
          const saleDateObj = new Date(saleDate);
          saleDateObj.setHours(0, 0, 0, 0)

          // Add other properties back if needed
          return { [dateKey]: saleDateObj, ...rest };
        });


        resolve(results.data);
      },
      error: error => {
        reject(error.message);
      }
    });
  });
}

// URLs of the CSV files you want to load
const csvUrls = [
  'manhattan.csv',
  'bronx.csv',
  'brooklyn.csv',
  'queens.csv',
  'statenisland.csv',
  'nyc_2018-2022.csv'
];

// Array to store promises for each CSV file
const csvPromises = csvUrls.map(url => loadCSV(`transactions/${url}`));


// Use Promise.all to wait for all promises to resolve
Promise.all(csvPromises)
  .then(resultsArray => {
    // Combine the results from all CSV files
    const combinedData = resultsArray.reduce((acc, data) => acc.concat(data), []);

    const columnDefs = [{
      headerName: "Sale Date", field: "SALE DATE",
      suppressSizeToFit: true,
      minWidth: 120,
    },
    {
      headerName: "Borough",
      field: "BOROUGH",
      valueGetter: (params) => {
        switch (params.data.BOROUGH) {
          case 1: return "Manhattan"
          case 2: return "Bronx"
          case 3: return "Brooklyn"
          case 4: return "Queens"
          case 5: return "Staten Island"
          default: return params.data.BOROUGH
        }
      }
    },
    {
      headerName: "Neighborhood", field: "NEIGHBORHOOD"
    },
    {
      headerName: "Category", field: "BUILDING CLASS CATEGORY"
    },
    {
      headerName: "Block", field: "BLOCK"
    },
    {
      headerName: "Lot", field: "LOT",
    },
    {
      headerName: "Address", field: "ADDRESS",
    },
    {
      headerName: "Apt #", field: "APARTMENT NUMBER"
    },
    {
      headerName: "Zipcode", field: "ZIPCODE"
    },
    {
      headerName: "Total Units", field: "TOTAL UNITS"
    },
    {
      headerName: "Land Sqft", field: "LAND SQUARE FEET"
    },
    {
      headerName: "Gross Sqft", field: "GROSS SQUARE FEET"
    },
    {
      headerName: "Year Built", field: "YEAR BUILT"
    },
    {
      headerName: "Sale Price", field: "SALE PRICE"
    }
    ]

    columnDefs[0].filter = 'agDateColumnFilter'

    const formattedCurrency = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });

    columnDefs[columnDefs.length - 1].valueFormatter = (params) => formattedCurrency.format(params.value)
    columnDefs[columnDefs.length - 1].filter = 'agNumberColumnFilter'

    const defaultColDef = {
      flex: 1,
      minWidth: 100,
      filter: 'agTextColumnFilter',
      menuTabs: ['filterMenuTab'],
      autoHeaderHeight: true,
      wrapHeaderText: true,
      sortable: true,
      resizable: true
    }

    // Initialize AG Grid
    const gridOptions = {
      columnDefs: columnDefs,
      rowData: combinedData,
      defaultColDef: defaultColDef,
    };

    // Create AG Grid
    const gridDiv = document.querySelector('#myGrid');
    new agGrid.Grid(gridDiv, gridOptions);
    gridOptions.api.sizeColumnsToFit()
  })
  .catch(error => {
    console.error('Error loading CSV files:', error);
  });

Promise.all([
  loadCSV("home_price_index.csv"),
  loadCSV("home_price_subindex.csv"),
  loadCSV("home_price_neighborhoods.csv")
])
  .then(([idx, idxb, idxn]) => {

    const manhattanCondo = idxb.filter(({ borough, house_class }) => borough == "Manhattan" & house_class == "Condo")
      .map(({ period, home_price_index }) => [period, home_price_index])

    const brooklynSFH = idxb.filter(({ borough, house_class }) => borough == "Brooklyn" & house_class == "SFH")
      .map(({ period, home_price_index }) => [period, home_price_index])

    const uws = idxn.filter(({ borough, neighborhood }) => borough == "Manhattan" & neighborhood == 'UPPER WEST SIDE (59-79)')
      .map(({ period, home_price_index }) => [period, home_price_index])

    const gramercy = idxn.filter(({ borough, neighborhood }) => borough == "Manhattan" & neighborhood == 'GRAMERCY')
      .map(({ period, home_price_index }) => [period, home_price_index])

    // Specify the configuration items and data for the chart
    const option = {
      title: {
        text: 'NYC Repeat Sales Home Price Index'
      },
      dataset: [
        {
          dimensions: [{ name: 'period', type: 'time' }, 'home_price_index'],
          source: idx,
        },
      ],
      tooltip: {
        trigger: 'axis'
      },
      legend: {
        data: ['NYC', 'Manhattan Condo', 'Brooklyn SFH', 'Upper West Side (59-79)', 'Gramercy'],
        selected: {
          'NYC': true,
          'Manhattan Condo': true,
          'Brooklyn SFH': true,
          'Upper West Side (59-79)': false, 
          'Gramercy': false,
        }
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
            y: 'home_price_index'
          }
        },
        {
          name: 'Manhattan Condo',
          type: 'line',
          symbol: 'none',
          data: manhattanCondo
        },
        {
          name: 'Brooklyn SFH',
          type: 'line',
          symbol: 'none',
          data: brooklynSFH
        },
        {
          name: 'Upper West Side (59-79)',
          type: 'line',
          symbol: 'none',
          data: uws
        },
        {
          name: 'Gramercy',
          type: 'line',
          symbol: 'none',
          data: gramercy
        }
      ]
    };

    // Display the chart using the configuration items and data just specified.
    myChart.setOption(option);
  })

// Initialize the echarts instance based on the prepared dom
var myChart = echarts.init(document.getElementById('main'));

