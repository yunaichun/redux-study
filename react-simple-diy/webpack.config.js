const webpack = require('webpack');
const path = require('path');
const glob = require('glob');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const {CleanWebpackPlugin} = require('clean-webpack-plugin');
const HardSourceWebpackPlugin = require('hard-source-webpack-plugin');

// == 多页面打包
const setMPA = () => {
    const entry = {};
    const htmlWebpackPlugins = [];
    const entryFiles = glob.sync(path.join(__dirname, './src/*/index.js'));
  
    Object.keys(entryFiles)
    .map((index) => {
        // == entry 入口
        const entryFile = entryFiles[index];
        const match = entryFile.match(/src\/(.*)\/index\.js/);
        const pageName = match && match[1];
        entry[pageName] = entryFile;

        // == HtmlWebpackPlugin 构建的页面
        return htmlWebpackPlugins.push(
            new HtmlWebpackPlugin({
                template: path.join(__dirname, `./src/${pageName}/index.html`),
                filename: `${pageName}.html`,
                chunks: [pageName],
                inject: true,
                minify: {
                    html5: true,
                    minifyJS: true,
                    minifyCSS: true,
                    removeComments: false,
                    collapseWhitespace: true,
                    preserveLineBreaks: false,
                },
            })
        );
    });
  
    return {
        entry,
        htmlWebpackPlugins,
    };
};
const { entry, htmlWebpackPlugins } = setMPA();

module.exports = {
    entry,
    output: {
        path: path.resolve('dist'),
        filename: '[name].js',
        publicPath: '/',
    },
    mode: 'development',
    optimization: {
        minimize: false,
    },
    devServer: {
        port: 8374,
        open: true,
        hot: true,
        contentBase: path.resolve('dist'),
        openPage: `JSX.html`,
        index: `JSX.html`,
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                use: [
                    {
                        loader: 'thread-loader',
                        options: {
                          workers: 2,
                        },
                    },
                    {
                        loader: 'babel-loader',
                        options: {
                            presets: ['@babel/preset-env'],
                            plugins: [['@babel/plugin-transform-react-jsx', {pragma: 'createElement'}]]
                        },
                    },
                ]
            }
        ]
    },
    plugins: [
        // new CleanWebpackPlugin(),
        new HardSourceWebpackPlugin(),
        new webpack.HotModuleReplacementPlugin(),
    ].concat(htmlWebpackPlugins)
};
