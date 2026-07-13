const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

// publicPath must be '/' ONLY when served by webpack-dev-server (Electron
// loadURL http://localhost:3000) — an absolute path breaks dev-server routing
// otherwise. Every build written to build/ is loaded by Electron via loadFile
// + file://, where an absolute '/bundle.js' resolves to the filesystem root
// (ERR_FILE_NOT_FOUND). Key this on `serve`, NOT the mode: the single-terminal
// dev flow builds with --mode development yet still loads from file://.
module.exports = (env = {}, argv) => {
  const isProd = argv.mode === 'production';
  const isServe = !!env.WEBPACK_SERVE;

  return {
  mode: isProd ? 'production' : 'development',
  entry: './src/renderer/index.jsx',
  target: 'web',
  output: {
    path: path.resolve(__dirname, 'build'),
    filename: 'bundle.js',
    publicPath: isServe ? '/' : './',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            sourceType: 'unambiguous',
            presets: [['@babel/preset-env', { modules: false }], ['@babel/preset-react', { runtime: 'automatic' }]],
          },
        },
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader', 'postcss-loader'],
      },
      {
        test: /\.(png|jpe?g|gif|svg|ico)$/i,
        type: 'asset/resource',
      },
      // pdfjs-dist's worker — emitted as a separate file and referenced by
      // GlobalWorkerOptions.workerSrc. Must come before any rule that would
      // try to parse .mjs as a JS module.
      {
        test: /pdf\.worker(?:\.min)?\.mjs$/,
        type: 'asset/resource',
        generator: { filename: '[name][ext]' },
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.jsx'],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/renderer/index.html',
    }),
  ],
  devServer: {
    port: 3000,
    hot: true,
    historyApiFallback: true,
  },
};
};
