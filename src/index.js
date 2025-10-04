import { BinanceTrader } from './bot.js';

const configUAH = {
    asset: 'UAH',
    base: 'USDT',
    clearanceSell: 0.05,
    clearanceBuy: 0.15,
    tickInterval: 10000,
    sellStepInUsdt: 20,
    limitBase: 500,
};

const uahTrade = new BinanceTrader(configUAH);
uahTrade.tick();
