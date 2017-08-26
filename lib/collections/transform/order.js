import accounting from "accounting-js";
import _ from "lodash";
import { Shops } from "/lib/collections";


/**
 * getSummary
 * @summary iterates over cart items with computations
 * @param {Array} items - cart.items array
 * @param {Array} prop - path to item property represented by array
 * @param {Array} [prop2] - path to another item property represented by array
 * @param {String} [shopId] - shopId
 * @return {Number} - computations result
 */
function getSummary(items, prop, prop2, shopId) {
  try {
    if (Array.isArray(items)) {
      return items.reduce((sum, item) => {
        if (prop2) {
          if (shopId) {
            if (shopId === item.shopId) {
              // if we're looking for a specific shop's items and this item does match
              return sum + item[prop[0]] * (prop2.length === 1 ? item[prop2[0]] :
                item[prop2[0]][prop2[1]]);
            }
            // If we're looking for a specific shop's items and this item doesn't match
            return sum;
          }
          // No shopId param
          // S + a * b, where b could be b1 or b2
          return sum + item[prop[0]] * (prop2.length === 1 ? item[prop2[0]] :
            item[prop2[0]][prop2[1]]);
        }
        // No prop2 param
        // S + b, where b could be b1 or b2
        return sum + (prop.length === 1 ? item[prop[0]] :
          item[prop[0]][prop[1]]);
      }, 0);
    }
  } catch (e) {
    // If data not prepared we should send a number to avoid exception with
    // `toFixed`. This could happens if user stuck on `completed` checkout stage
    // by some reason.
    return 0;
  }
  return 0;
}

/**
 * Reaction transform collections
 *
 * transform methods used to return order calculated values
 * orderCount, orderSubTotal, orderShipping, orderTaxes, orderTotal
 * are calculated by a transformation on the collection
 * and are available to use in template as order.xxx
 * in template: {{order.orderCount}}
 * in code: order.findOne().orderTotal()
 */
export const orderTransform = {
  /**
   * Return the total quantity on the order
   * @method orderCount
   * @returns {Number}  Total quantity of items on the order
   */
  orderCount() {
    return getSummary(this.items, ["quantity"]);
  },
  /**
   * Return the total price of shipping/handling on the order
   * @method orderShipping
   * @returns {Number} Total price of shipping/handling on the order
   */
  orderShipping() {
    const rate = getSummary(this.shipping, ["shipmentMethod", "rate"]);
    const handling = getSummary(this.shipping, ["shipmentMethod", "handling"]);
    const shipping = handling + rate || 0;
    return accounting.toFixed(shipping, 2);
  },
  /**
   * Get the total price of shipping, broken down by shop
   * @method getShippingByShop
   * @returns {{Object}} - Total price of shipping, broken down by shop
   */
  orderShippingByShop() {
    const billingObject = {};
    for (const billingItem of this.billing) {
      billingObject[billingItem.shopId] = billingItem.invoice.shipping;
    }
    return billingObject;
  },
  /**
   * Return the total price of goods on an order
   * @method orderSubTotal
   * @returns {Number} Total price of goods for the order
   */
  orderSubTotal() {
    const subTotal = getSummary(this.items, ["quantity"], ["variants", "price"]);
    return accounting.toFixed(subTotal, 2);
  },
  /**
   * Return the total price of goods on an order, broken down by shop
   * @method orderSubTotalByShop
   * @returns {Object} Total price of goods on an order, broken down by shop
   */
  orderSubTotalByShop() {
    return this.items.reduce((uniqueShopSubTotals, item) => {
      if (!uniqueShopSubTotals[item.shopId]) {
        const subTotal = getSummary(this.items, ["quantity"], ["variants", "price"], item.shopId);
        uniqueShopSubTotals[item.shopId] = accounting.toFixed(subTotal, 2);
        return uniqueShopSubTotals;
      }
      return uniqueShopSubTotals;
    }, {});
  },
  /**
   * Total taxes for order
   * @method orderTaxes
   * @returns {Number} Total price of taxes for an order
   */
  orderTaxes() {
    // taxes are calculated in a order.after.update hooks
    // the tax value stored with the order is the effective tax rate
    // calculated by line items
    // in the imports/core/taxes plugin
    const tax = this.tax || 0;
    const subTotal = parseFloat(this.orderSubTotal());
    const taxTotal = subTotal * tax;
    return accounting.toFixed(taxTotal, 2);
  },
  /**
   * Total taxes for order broken down by shop
   * @method orderTaxesByShop
   * @returns {Object} Taxes broken down by Shop
   */
  orderTaxesByShop() {
    const billingObject = {};
    for (const billingItem of this.billing) {
      billingObject[billingItem.shopId] = accounting.toFixed(billingItem.invoice.taxes, 2);
    }
    return billingObject;
  },
  /**
   * Discount for order
   * @method orderDiscounts
   * @return {Number} Total value of discounts
   */
  orderDiscounts() {
    const discount = this.discount || 0;
    return accounting.toFixed(discount, 2);
  },
  /**
   * Total for Order
   * @method orderTotal
   * @return {Number} Total for order
   */
  orderTotal() {
    const subTotal = parseFloat(this.orderSubTotal());
    const shipping = parseFloat(this.orderShipping());
    const taxes = parseFloat(this.orderTaxes());
    const discount = parseFloat(this.orderDiscounts());
    const discountTotal = Math.max(0, subTotal - discount);
    const total = discountTotal + shipping + taxes;
    return accounting.toFixed(total, 2);
  },
  /**
   * Create an object that gives a summary for each shop
   * @method getShopSummary
   * @return {Object}  An object with a key for each shopId, and name + summary data for each
   */
  getShopSummary() {
    // massage items into an object by Shop
    const taxesByShop = this.orderTaxesByShop();
    const subTotalsByShop = this.orderSubTotalByShop();
    const shippingByShop = this.orderShippingByShop();
    const itemsByShop = this.items.reduce((shopItems, item) => {
      if (!shopItems[item.shopId]) {
        shopItems[item.shopId] = [item];
      } else {
        shopItems[item.shopId].push(item);
      }
      return shopItems;
    }, {});

    const shopObjects = Object.keys(itemsByShop).map(function (shop) {
      return {
        [shop]: {
          name: Shops.findOne(shop).name,
          subTotal: subTotalsByShop[shop],
          taxes: taxesByShop[shop],
          items: itemsByShop[shop],
          quantityTotal: itemsByShop[shop].reduce((qty, item) => {
            return qty + item.quantity;
          }, 0),
          shipping: shippingByShop[shop]
        }
      };
    });

    const sortedShopObjects = _.sortBy(shopObjects, (shopObject) => shopObject.name);
    return sortedShopObjects;
  },
  /**
   * Returns an array of payment methods, normalized
   * @method getPaymentMethod
   * @returns {Array} Array of Payment Method objects
   */
  getPaymentMethods() {
    const billingMethods = this.billing.map((method) => {
      return method.paymentMethod;
    });
    const methodObjects = billingMethods.map((method) => {
      const paymentMethodObject = {
        storedCard: method.storedCard,
        processor: method.processor,
        mode: method.mode,
        transactionId: method.transactionId,
        amount: method.amount,
        method: method.method
      };
      return paymentMethodObject;
    });
    return methodObjects;
  }
};
