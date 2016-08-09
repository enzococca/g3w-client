var t = require('core/i18n/i18n.service').t;
var inherit = require('core/utils/utils').inherit;
var base = require('core/utils/utils').base;
var merge = require('core/utils/utils').merge;
var Component = require('gui/vue/component');

var ToolsService = require('gui/tools/toolsservice');

var InternalComponent = Vue.extend({
    template: require('./tools.html'),
    data: function() {
      return {
        state: null
      }
    },
    methods: {
      fireAction: function(actionid){
        this.$options.toolsService.fireAction(actionid);
      }
    }
});

function ToolsComponent(options){
  base(this,options);
  var self = this;
  this._toolsService = new ToolsService();
  this.id = "tools-component";
  this.title = "tools";
  this.state.visible = false;
  this._toolsService.onafter('addToolGroup',function(){
    self.state.visible = self._toolsService.state.toolsGroups.length > 0;
  })
  merge(this, options);
  this.internalComponent = new InternalComponent({
    toolsService: this._toolsService
  });
  this.internalComponent.state = this._toolsService.state
}

inherit(ToolsComponent, Component);

var proto = ToolsComponent.prototype;

proto.getToolsService = function() {
  return this._toolsService;
};

module.exports = ToolsComponent;
