export interface GlossaryTerm {
  term: string;
  definition: string;
}

const RU: GlossaryTerm[] = [
  { term: 'Ask', definition: 'Цена, по которой брокер продаёт вам базовую валюту (цена покупки для трейдера). Всегда выше Bid.' },
  { term: 'Bid', definition: 'Цена, по которой брокер покупает у вас базовую валюту (цена продажи для трейдера).' },
  { term: 'CFD', definition: 'Contract for Difference — контракт на разницу цен. Позволяет зарабатывать на движении актива без владения им самим.' },
  { term: 'ECN', definition: 'Electronic Communication Network — модель исполнения, при которой заявки клиентов выводятся напрямую в сеть поставщиков ликвидности с минимальными спредами и комиссией.' },
  { term: 'Волатильность', definition: 'Мера изменчивости цены за период. Высокая волатильность — большие движения и большие риски; низкая — узкие диапазоны.' },
  { term: 'Гэп', definition: 'Разрыв на графике между ценой закрытия и следующего открытия. Часто возникает после выходных или важных новостей.' },
  { term: 'Кредитное плечо', definition: 'Отношение размера позиции к собственным средствам трейдера. Плечо 1:100 позволяет управлять позицией в 100 раз больше залога.' },
  { term: 'Лот', definition: 'Стандартная единица объёма сделки. На Forex 1 лот = 100 000 единиц базовой валюты; минимальный объём у большинства брокеров — 0.01 лота.' },
  { term: 'Маржа', definition: 'Залог, который блокируется на счёте при открытии позиции с кредитным плечом. Возвращается после закрытия сделки.' },
  { term: 'Маржин-колл (Margin Call)', definition: 'Предупреждение брокера о том, что средств на счёте почти не хватает для поддержания открытых позиций.' },
  { term: 'Пункт (pip)', definition: 'Минимальный шаг цены валютной пары. Для большинства пар — изменение четвёртого знака после запятой (0.0001).' },
  { term: 'Своп', definition: 'Плата или начисление за перенос позиции через ночь, зависит от разницы процентных ставок валют в паре.' },
  { term: 'Спред', definition: 'Разница между ценами Ask и Bid — основная транзакционная издержка трейдера.' },
  { term: 'Стоп-аут (Stop Out)', definition: 'Принудительное закрытие позиций брокером, когда уровень маржи падает ниже критического значения.' },
  { term: 'Стоп-лосс (Stop Loss)', definition: 'Ордер, автоматически закрывающий позицию при достижении заданного убытка. Главный инструмент управления риском.' },
  { term: 'Тейк-профит (Take Profit)', definition: 'Ордер, автоматически фиксирующий прибыль при достижении целевой цены.' },
  { term: 'Тренд', definition: 'Устойчивое направленное движение цены: восходящий (растущие максимумы и минимумы) или нисходящий.' },
  { term: 'Уровень поддержки', definition: 'Ценовая зона, где спрос ранее останавливал падение. Зеркальное понятие — уровень сопротивления.' },
];

const EN: GlossaryTerm[] = [
  { term: 'Ask', definition: 'The price at which the broker sells you the base currency (the buy price for the trader). Always higher than the Bid.' },
  { term: 'Bid', definition: 'The price at which the broker buys the base currency from you (the sell price for the trader).' },
  { term: 'CFD', definition: 'Contract for Difference. Lets you profit from an asset’s price movement without owning the asset itself.' },
  { term: 'ECN', definition: 'Electronic Communication Network — an execution model where client orders are routed directly to a network of liquidity providers with minimal spreads plus a commission.' },
  { term: 'Gap', definition: 'A break on the chart between the closing price and the next opening price. Often occurs after weekends or major news.' },
  { term: 'Leverage', definition: 'The ratio of position size to the trader’s own funds. 1:100 leverage lets you control a position 100 times larger than your collateral.' },
  { term: 'Lot', definition: 'The standard unit of trade volume. In Forex, 1 lot = 100,000 units of the base currency; most brokers allow trading from 0.01 lots.' },
  { term: 'Margin', definition: 'Collateral locked on the account when a leveraged position is opened. Released after the trade is closed.' },
  { term: 'Margin Call', definition: 'A broker warning that account funds are barely sufficient to maintain open positions.' },
  { term: 'Pip', definition: 'The minimum price increment of a currency pair. For most pairs — a change in the fourth decimal place (0.0001).' },
  { term: 'Spread', definition: 'The difference between the Ask and Bid prices — the trader’s main transaction cost.' },
  { term: 'Stop Loss', definition: 'An order that automatically closes a position when a specified loss is reached. The main risk-management tool.' },
  { term: 'Stop Out', definition: 'Forced closing of positions by the broker when the margin level falls below a critical value.' },
  { term: 'Support level', definition: 'A price zone where demand previously stopped a decline. The mirror concept is a resistance level.' },
  { term: 'Swap', definition: 'A charge or credit for holding a position overnight, based on the interest-rate differential of the pair’s currencies.' },
  { term: 'Take Profit', definition: 'An order that automatically locks in profit when a target price is reached.' },
  { term: 'Trend', definition: 'A sustained directional price move: up (rising highs and lows) or down.' },
  { term: 'Volatility', definition: 'A measure of price variability over a period. High volatility — big moves and big risks; low — narrow ranges.' },
];

export function getGlossaryTerms(locale: string): GlossaryTerm[] {
  return locale === 'en' ? EN : RU;
}
