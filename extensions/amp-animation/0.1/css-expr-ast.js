/**
 * Copyright 2017 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const FINAL_URL_RE = /^(data|https)\:/i;
const DEG_TO_RAD = 2 * Math.PI / 360;
const GRAD_TO_RAD = Math.PI / 200;


/**
 * An interface that assists in CSS evaluation.
 * @interface
 */
export class CssContext {

  /**
   * Returns a resolved URL. The result must be an allowed URL for execution,
   * with HTTPS restrictions.
   * @param {string} unusedUrl
   * @return {string}
   */
  resolveUrl(unusedUrl) {}

  /**
   * Returns the value of a CSS variable or `null` if not available.
   * @param {string} unusedVarName
   * @return {?CssNode}
   */
  getVar(unusedVarName) {}

  /**
   * Returns the current font size.
   * @return {number}
   */
  getCurrentFontSize() {}

  /**
   * Returns the root font size.
   * @return {number}
   */
  getRootFontSize() {}

  /**
   * Returns the viewport size.
   * @return {!{width: number, height: number}}
   */
  getViewportSize() {}

  /**
   * Returns the current element's size.
   * @return {!{width: number, height: number}}
   */
  getCurrentElementSize() {}

  /**
   * Returns the dimension: "w" for width or "h" for height.
   * @return {?string}
   */
  getDimension() {}

  /**
   * Pushes the dimension: "w" for width or "h" for height.
   * @param {?string} unusedDim
   */
  pushDimension(unusedDim) {}

  /**
   * Pops the dimension.
   */
  popDimension() {}
}


/**
 * A base class for all CSS node components defined in the
 * `css-expr-impl.jison`.
 * @abstract
 */
export class CssNode {
  constructor() {}

  /**
   * Returns a string CSS representation.
   * @return {string}
   * @abstract
   */
  css() {}

  /**
   * Resolves the value of all variable components. Only performs any work if
   * variable components exist. As an optimization, this node is returned
   * for a non-variable nodes (`isConst() == true`). Otherwise, `calc()` method
   * is used to calculate the new value.
   * @param {!CssContext} context
   * @return {?CssNode}
   * @final
   */
  resolve(context) {
    if (this.isConst()) {
      return this;
    }
    return this.calc(context);
  }

  /**
   * Whether the CSS node is a constant or includes variable components.
   * @return {boolean}
   * @protected
   */
  isConst() {
    return true;
  }

  /**
   * Calculates the value of all variable components.
   * @param {!CssContext} unusedContext
   * @return {?CssNode}
   * @protected
   */
  calc(unusedContext) {
    return this;
  }
}


/**
 * A CSS expression that's simply passed through from the original expression.
 * Used for `url()`, colors, etc.
 */
export class CssPassthroughNode extends CssNode {
  /** @param {string} css */
  constructor(css) {
    super();
    /** @const @private {string} */
    this.css_ = css;
  }

  /** @override */
  css() {
    return this.css_;
  }
}


/**
 * A concatenation of CSS expressions: `translateX(...) rotate(...)`,
 * `1s normal`, etc.
 */
export class CssConcatNode extends CssNode {
  /** @param {!Array<!CssNode>=} opt_array */
  constructor(opt_array) {
    super();
    /** @private {!Array<!CssNode>} */
    this.array_ = opt_array || [];
  }

  /**
   * Concatenates two sets of expressions.
   * @param {!CssNode} nodeOrSet
   * @param {!CssNode} otherNodeOrSet
   * @return {!CssConcatNode}
   */
  static concat(nodeOrSet, otherNodeOrSet) {
    let set;
    if (nodeOrSet instanceof CssConcatNode) {
      set = nodeOrSet;
    } else {
      set = new CssConcatNode([nodeOrSet]);
    }
    if (otherNodeOrSet instanceof CssConcatNode) {
      set.array_ = set.array_.concat(otherNodeOrSet.array_);
    } else {
      set.array_.push(otherNodeOrSet);
    }
    return set;
  }

  /** @override */
  css() {
    return this.array_.map(node => node.css()).join(' ');
  }

  /** @override */
  isConst() {
    return this.array_.reduce((acc, node) => acc && node.isConst(), true);
  }

  /** @override */
  calc(context) {
    const resolvedArray = [];
    for (let i = 0; i < this.array_.length; i++) {
      const resolved = this.array_[i].resolve(context);
      if (resolved) {
        resolvedArray.push(resolved);
      } else {
        // One element is null - the result is null.
        return null;
      }
    }
    return new CssConcatNode(resolvedArray);
  }
}


/**
 * Verifies that URL is an HTTPS URL.
 */
export class CssUrlNode extends CssNode {
  /** @param {string} url */
  constructor(url) {
    super();
    /** @const @private {string} */
    this.url_ = url;
  }

  /** @override */
  css() {
    if (!this.url_) {
      return '';
    }
    return `url("${this.url_}")`;
  }

  /** @override */
  isConst() {
    return !this.url_ || FINAL_URL_RE.test(this.url_);
  }

  /** @override */
  calc(context) {
    const url = context.resolveUrl(this.url_);
    // Return a passthrough CSS to avoid recursive `url()` evaluation.
    return new CssPassthroughNode(`url("${url}")`);
  }
}


/**
 * @abstract
 */
export class CssNumericNode extends CssNode {
  /**
   * @param {string} type
   * @param {number} num
   * @param {string} units
   */
  constructor(type, num, units) {
    super();
    /** @const @private {string} */
    this.type_ = type;
    /** @const @private {number} */
    this.num_ = num;
    /** @const @private {string} */
    this.units_ = units.toLowerCase();
  }

  /** @override */
  css() {
    return `${this.num_}${this.units_}`;
  }

  /**
   * @param {number} unusedNum
   * @return {!CssNumberNode}
   * @abstract
   */
  createSameUnits(unusedNum) {}

  /**
   * @param {!CssContext} unusedContext
   * @return {!CssNumberNode}
   */
  norm(unusedContext) {
    return this;
  }

  /**
   * @param {number} percent
   * @param {!CssContext} unusedContext
   * @return {!CssNumberNode}
   */
  calcPercent(percent, unusedContext) {
    throw new Error('cannot calculate percent for ' + this.type_);
  }
}


/**
 * A CSS number: `100`, `1e2`, `1e-2`, `0.5`, etc.
 */
export class CssNumberNode extends CssNumericNode {
  /** @param {number} num */
  constructor(num) {
    super('NUM', num, '');
  }

  /** @override */
  createSameUnits(num) {
    return new CssNumberNode(num);
  }
}


/**
 * A CSS percent value: `100%`, `0.5%`, etc.
 */
export class CssPercentNode extends CssNumericNode {
  /** @param {number} num */
  constructor(num) {
    super('PRC', num, '%');
  }

  /** @override */
  createSameUnits(num) {
    return new CssPercentNode(num);
  }
}


/**
 * A CSS length value: `100px`, `80vw`, etc.
 */
export class CssLengthNode extends CssNumericNode {
  /**
   * @param {number} num
   * @param {string} units
   */
  constructor(num, units) {
    super('LEN', num, units);
  }

  /** @override */
  createSameUnits(num) {
    return new CssLengthNode(num, this.units_);
  }

  /** @override */
  norm(context) {
    if (this.units_ == 'px') {
      return this;
    }

    // Font-based: em/rem.
    if (this.units_ == 'em' || this.units_ == 'rem') {
      const fontSize = this.units_ == 'em' ?
          context.getCurrentFontSize() :
          context.getRootFontSize();
      return new CssLengthNode(this.num_ * fontSize, 'px');
    }

    // Viewport based: vw, vh, vmin, vmax.
    if (this.units_ == 'vw' ||
        this.units_ == 'vh' ||
        this.units_ == 'vmin' ||
        this.units_ == 'vmax') {
      const vp = context.getViewportSize();
      const vw = vp.width * this.num_ / 100;
      const vh = vp.height * this.num_ / 100;
      let num = 0;
      if (this.units_ == 'vw') {
        num = vw;
      } else if (this.units_ == 'vh') {
        num = vh;
      } else if (this.units_ == 'vmin') {
        num = Math.min(vw, vh);
      } else if (this.units_ == 'vmax') {
        num = Math.max(vw, vh);
      }
      return new CssLengthNode(num, 'px');
    }

    // Can't convert cm/in/etc to px at this time.
    throw unknownUnits(this.units_);
  }

  /** @override */
  calcPercent(percent, context) {
    const dim = context.getDimension();
    const size = context.getCurrentElementSize();
    const side =
        dim == 'w' ? size.width :
        dim == 'h' ? size.height :
        0;
    return new CssLengthNode(side * percent / 100, 'px');
  }
}


/**
 * A CSS angle value: `45deg`, `0.5rad`, etc.
 */
export class CssAngleNode extends CssNumericNode {
  /**
   * @param {number} num
   * @param {string} units
   */
  constructor(num, units) {
    super('ANG', num, units);
  }

  /** @override */
  createSameUnits(num) {
    return new CssAngleNode(num, this.units_);
  }

  /** @override */
  norm() {
    if (this.units_ == 'rad') {
      return this;
    }
    if (this.units_ == 'deg') {
      return new CssAngleNode(this.num_ * DEG_TO_RAD, 'rad');
    }
    if (this.units_ == 'grad') {
      return new CssAngleNode(this.num_ * GRAD_TO_RAD, 'rad');
    }
    throw unknownUnits(this.units_);
  }
}


/**
 * A CSS time value: `1s`, `600ms`.
 */
export class CssTimeNode extends CssNumericNode {
  /**
   * @param {number} num
   * @param {string} units
   */
  constructor(num, units) {
    super('TME', num, units);
  }

  /** @override */
  createSameUnits(num) {
    return new CssTimeNode(num, this.units_);
  }

  /** @override */
  norm() {
    if (this.units_ == 'ms') {
      return this;
    }
    if (this.units_ == 's') {
      return new CssTimeNode(this.num_ * 1000, 'ms');
    }
    throw unknownUnits(this.units_);
  }
}


/**
 * A CSS generic function: `rgb(1, 1, 1)`, `translateX(300px)`, etc.
 */
export class CssFuncNode extends CssNode {
  /**
   * @param {string} name
   * @param {!Array<!CssNode>} args
   * @param {?Array<string>=} opt_dimensions
   */
  constructor(name, args, opt_dimensions) {
    super();
    /** @const @private {string} */
    this.name_ = name.toLowerCase();
    /** @const @private {!Array<!CssNode>} */
    this.args_ = args;
    /** @const @private {?Array<string>} */
    this.dimensions_ = opt_dimensions || null;
  }

  /** @override */
  css() {
    const args = this.args_.map(node => node.css()).join(',');
    return `${this.name_}(${args})`;
  }

  /** @override */
  isConst() {
    return this.args_.reduce((acc, node) => acc && node.isConst(), true);
  }

  /** @override */
  calc(context) {
    const resolvedArgs = [];
    for (let i = 0; i < this.args_.length; i++) {
      const node = this.args_[i];
      let resolved;
      if (this.dimensions_ && i < this.dimensions_.length) {
        context.pushDimension(this.dimensions_[i]);
        resolved = node.resolve(context);
        context.popDimension();
      } else {
        resolved = node.resolve(context);
      }
      if (resolved) {
        resolvedArgs.push(resolved);
      } else {
        // One argument is null - the function's result is null.
        return null;
      }
    }
    return new CssFuncNode(this.name_, resolvedArgs);
  }
}


/**
 * A CSS translate family of functions:
 * - `translate(x, y)`
 * - `translateX(x)`
 * - `translateY(y)`
 * - `translateZ(z)`
 * - `translate3d(x, y, z)`
 */
export class CssTranslateNode extends CssFuncNode {
  /**
   * @param {string} suffix
   * @param {!Array<!CssNode>} args
   */
  constructor(suffix, args) {
    super(`translate${suffix.toUpperCase()}`, args,
        suffix == '' ? ['w', 'h'] :
        suffix == 'x' ? ['w'] :
        suffix == 'y' ? ['h'] :
        suffix == 'z' ? ['z'] :
        suffix == '3d' ? ['w', 'h', 'z'] : null);
    /** @const @private {string} */
    this.suffix_ = suffix;
  }
}


/**
 * A CSS `var()` expression: `var(--name)`, `var(--name, 100px)`, etc.
 * See https://www.w3.org/TR/css-variables/.
 */
export class CssVarNode extends CssNode {
  /**
   * @param {string} varName
   * @param {!CssNode=} opt_def
   */
  constructor(varName, opt_def) {
    super();
    /** @const @private {string} */
    this.varName_ = varName;
    /** @const @private {?CssNode} */
    this.def_ = opt_def || null;
  }

  /** @override */
  css() {
    return `var(${this.varName_}${this.def_ ? ',' + this.def_.css() : ''})`;
  }

  /** @override */
  isConst() {
    return false;
  }

  /** @override */
  calc(context) {
    const varNode = context.getVar(this.varName_);
    if (varNode) {
      return varNode.resolve(context);
    }
    if (this.def_) {
      return this.def_.resolve(context);
    }
    return null;
  }
}


/**
 * A CSS `calc()` expression: `calc(100px)`, `calc(80vw - 30em)`, etc.
 * See https://drafts.csswg.org/css-values-3/#calc-notation.
 */
export class CssCalcNode extends CssNode {
  /** @param {!CssNode} expr */
  constructor(expr) {
    super();
    /** @const @private {!CssNode} */
    this.expr_ = expr;
  }

  /** @override */
  css() {
    return `calc(${this.expr_.css()})`;
  }

  /** @override */
  isConst() {
    return false;
  }

  /** @override */
  calc(context) {
    return this.expr_.resolve(context);
  }
}


/**
 * A CSS `calc()` sum expression: `100px + 20em`, `80vw - 30em`, etc.
 */
export class CssCalcSumNode extends CssNode {
  /**
   * @param {!CssNode} left
   * @param {!CssNode} right
   * @param {string} op Either "+" or "-".
   */
  constructor(left, right, op) {
    super();
    /** @const @private {!CssNode} */
    this.left_ = left;
    /** @const @private {!CssNode} */
    this.right_ = right;
    /** @const @private {string} */
    this.op_ = op;
  }

  /** @override */
  css() {
    return `${this.left_.css()} ${this.op_} ${this.right_.css()}`;
  }

  /** @override */
  isConst() {
    return false;
  }

  /** @override */
  calc(context) {
    /*
     * From spec:
     * At + or -, check that both sides have the same type, or that one side is
     * a <number> and the other is an <integer>. If both sides are the same
     * type, resolve to that type. If one side is a <number> and the other is
     * an <integer>, resolve to <number>.
     */
    let left = this.left_.resolve(context);
    let right = this.right_.resolve(context);
    if (left == null || right == null) {
      return null;
    }
    if (!(left instanceof CssNumericNode) ||
        !(right instanceof CssNumericNode)) {
      throw new Error('left and right must be both numerical');
    }
    if (left.type_ != right.type_) {
      // Percent values are special: they need to be resolved in the context
      // of the other dimension.
      if (left instanceof CssPercentNode) {
        left = right.calcPercent(left.num_, context);
      } else if (right instanceof CssPercentNode) {
        right = left.calcPercent(right.num_, context);
      } else {
        throw new Error('left and right must be the same type');
      }
    }

    // Units are the same, the math is simple: numerals are summed. Otherwise,
    // the units neeed to be normalized first.
    if (left.units_ != right.units_) {
      left = left.norm(context);
      right = right.norm(context);
    }
    const sign = this.op_ == '+' ? 1 : -1;
    return left.createSameUnits(left.num_ + sign * right.num_);
  }
}


/**
 * A CSS `calc()` product expression: `100px * 2`, `80vw / 2`, etc.
 */
export class CssCalcProductNode extends CssNode {
  /**
   * @param {!CssNode} left
   * @param {!CssNode} right
   * @param {string} op Either "*" or "/".
   */
  constructor(left, right, op) {
    super();
    /** @const @private {!CssNode} */
    this.left_ = left;
    /** @const @private {!CssNode} */
    this.right_ = right;
    /** @const @private {string} */
    this.op_ = op;
  }

  /** @override */
  css() {
    return `${this.left_.css()} ${this.op_} ${this.right_.css()}`;
  }

  /** @override */
  isConst() {
    return false;
  }

  /** @override */
  calc(context) {
    const left = this.left_.resolve(context);
    const right = this.right_.resolve(context);
    if (left == null || right == null) {
      return null;
    }
    if (!(left instanceof CssNumericNode) ||
        !(right instanceof CssNumericNode)) {
      throw new Error('left and right must be both numerical');
    }

    /*
     * From spec:
     * At *, check that at least one side is <number>. If both sides are
     * <integer>, resolve to <integer>. Otherwise, resolve to the type of the
     * other side.
     * At /, check that the right side is <number>. If the left side is
     * <integer>, resolve to <number>. Otherwise, resolve to the type of the
     * left side.
     */
    let base;
    let multi;
    if (this.op_ == '*') {
      if (left instanceof CssNumberNode) {
        multi = left.num_;
        base = right;
      } else {
        if (!(right instanceof CssNumberNode)) {
          throw new Error('one of sides in multiplication must be a number');
        }
        multi = right.num_;
        base = left;
      }
    } else {
      if (!(right instanceof CssNumberNode)) {
        throw new Error('denominator must be a number');
      }
      base = left;
      multi = 1 / right.num_;
    }

    const num = base.num_ * multi;
    if (!isFinite(num)) {
      return null;
    }
    return base.createSameUnits(num);
  }
}


/**
 * @param {string} units
 * @return {!Error}
 */
function unknownUnits(units) {
  return new Error('unknown units: ' + units);
}