# manhattan
Real estate price index for Manhattan.

See the Jupyter Notebook file for contents.

See Google Colab notebook [here](https://colab.research.google.com/drive/146YWBs3Jmdigh09vn8bkKMtiW3jDjMHm?usp=sharing) that could be updated with live data and modified.

How to get the GeoJSON shapefile:

1. Download massive archive of NYC shapefiles here:
[https://data.cityofnewyork.us/Housing-Development/Department-of-Finance-Digital-Tax-Map/smk3-tmxj]

2. Run `ogr2ogr -f GeoJSON -t_srs crs:84 blocklot.geojson Digital_Tax_Map_20200807/DTM_Tax_Block_Polygon.shp`
