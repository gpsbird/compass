var _ = require('lodash');
var debug = require('debug')('scout:minicharts:index');
var d3 = require('d3');

var LeafValue = require('mongodb-language-model').LeafValue;
var ListOperator = require('mongodb-language-model').ListOperator;
var Range = require('mongodb-language-model').helpers.Range;

var MODIFIERKEY = 'shiftKey';

module.exports = {
  /**
   * Extract a value that can be compared
   * @param  {Object} d   event data object triggered by the minichart
   * @return {Any}        value to be returned that can be used for comparisons < and >
   */
  _getComparableValue: function(d) {
    return d.value._bsontype === 'ObjectID' ? d.value.getTimestamp() : d.value;
  },

  /**
   * Handler for query builder events that result in distinct selection, e.g. string and unique
   * type. Single click selects individual element, shift-click adds to selection.
   * @param  {Object} data   the contains information about the event, @see handleQueryBuilderEvent
   */
  handleDistinctEvent: function(data) {
    // update selectedValues
    if (!data.evt[MODIFIERKEY]) {
      if (this.selectedValues.length === 1 && this.selectedValues[0].self === data.self) {
        this.selectedValues = [];
      } else {
        this.selectedValues = [data];
      }
    } else if (_.contains(_.pluck(this.selectedValues, 'd.label'), data.d.label)) {
      _.remove(this.selectedValues, function(d) { return d.d.label === data.d.label; });
    } else {
      this.selectedValues.push(data);
    }

    // visual updates
    _.each(data.all, function(el) {
      el.classList.remove('selected');
      if (this.selectedValues.length === 0) {
        // remove all styling
        el.classList.remove('unselected');
      } else {
        el.classList.add('unselected');
      }
    }.bind(this));
    _.each(this.selectedValues, function(selected) {
      selected.self.classList.add('selected');
      selected.self.classList.remove('unselected');
    });

    // build new refineValue
    if (this.selectedValues.length === 0) {
      // no value
      this.unset('refineValue');
    } else if (this.selectedValues.length === 1) {
      // single value
      this.refineValue = new LeafValue(this.selectedValues[0].d.value, {
        parse: true
      });
    } else {
      // multiple values
      this.refineValue = new ListOperator({
        $in: this.selectedValues.map(function(el) {
          return el.d.value;
        })
      }, { parse: true });
    }
  },

  /**
   * Handler for query builder events that result in range selection, e.g. number type.
   * single click selects individual element, shift-click extends to range (the single click is
   * interpreted as one end of the range, shift-click as the other).
   * @param  {Object} data   the contains information about the event, @see handleQueryBuilderEvent
   */
  handleRangeEvent: function(data) {
    if (data.evt[MODIFIERKEY]) {
      this.selectedValues[1] = data;
    } else if (this.selectedValues[0] && this.selectedValues[0].d.label === data.d.label) {
      this.selectedValues = [];
    } else {
      this.selectedValues = [data];
    }
    var firstSelected = this.selectedValues[0];
    // remove `.selected` class from all elements
    _.each(data.all, function(el) {
      el.classList.remove('selected');
      if (!firstSelected) {
        el.classList.remove('unselected');
      } else {
        el.classList.add('unselected');
      }
    });
    if (!firstSelected) {
      // no value
      this.unset('refineValue');
    } else {
      var getComparableValue = this._getComparableValue.bind(this);
      var first = _.min(this.selectedValues, function(el) {
        return getComparableValue(el.d);
      });
      var last = _.max(this.selectedValues, function(el) {
        return getComparableValue(el.d);
      });

      // use getComparableValue to determine what elements should be selected
      var lower = getComparableValue(first.d);
      var upper = getComparableValue(last.d);
      if (this.model.getType() === 'Number') {
        upper += last.d.dx;
      }

      /**
       * if the UI element represents a range (i.e. binned histograms where one bar represents
       * 20-30, the next one 30-40, etc.) then the upper limit is non-inclusive ($lt).
       * If however the UI elements represents a single number, then the upper limit is
       * inclusive ($lte).
       * This is indicated by the d.dx variable, which is only > 0 for binned ranges.
       */
      var upperInclusive = last.d.dx === 0;
      _.each(data.all, function(el) {
        var elData = getComparableValue(d3.select(el).data()[0]);
        if (elData >= lower && (upperInclusive ? elData <= upper : elData < upper)) {
          el.classList.add('selected');
          el.classList.remove('unselected');
        }
      });

      // now use .value to build query
      lower = first.d.value;
      upper = last.d.value;
      if (this.model.getType() === 'Number') {
        upper += last.d.dx;
      }
      if (lower === upper) {
        this.refineValue = new LeafValue({ content: lower });
      } else {
        this.refineValue = new Range(lower, upper, upperInclusive);
      }
    }
  },
  /**
   * Handles query builder events, routing them to the appropriate specific handler methods
   * @param  {Object} data   contains information about the event, namely
   * {
   *   d: the data point
   *   i: the index of the clicked element
   *   self: the dom element itself
   *   all: all clickable dom elements in this chart
   *   evt: the event object
   *   type: the type of event (currently only 'click')
   *   source: where the event originated, currently 'few', 'many', 'unique', 'date'
   * }
   */
  handleQueryBuilderEvent: function(data) {
    data.evt.stopPropagation();
    data.evt.preventDefault();

    switch (this.model.getType()) {
      case 'Boolean': // fall-through to String
      case 'String':
        this.handleDistinctEvent(data);
        break;
      case 'Number':
        if (data.source === 'unique') {
          this.handleDistinctEvent(data);
        } else {
          this.handleRangeEvent(data);
        }
        break;
      case 'ObjectID': // fall-through to Date
      case 'Date':
        // @todo: for dates, data.all is not sorted, so this is not yet working
        this.handleRangeEvent(data);
        break;
      default: // @todo other types not implemented yet
        break;
    }
  }
};
