import { rasterize } from "../../src/export/raster";

(window as unknown as { stamRasterize: typeof rasterize }).stamRasterize = rasterize;
