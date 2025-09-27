import { BinanceTrader } from './bot.js';

const configUAH = {
    asset: 'UAH',
    base: 'USDT',
    clearanceSell: 0.2,
    clearanceBuy: 0.25,
    tickInterval: 15000,
    sellStepInUsdt: 20,
    maxOrderByUSD: 10,
    maxAssetOrderByUsd: 40,
};

const uahTrade = new BinanceTrader(configUAH);
uahTrade.tick();
