var inherit = require('./utils').inherit;
var base = require('./utils').base;
var deferredValue = require('./utils').deferredValue;
var G3WObject = require('g3w/core/g3wobject');
var GUI = require('g3w/gui/gui');
var ProjectsRegistry = require('./projectsregistry');
var ProjectService = require('./projectservice').ProjectService;
var ProjectTypes = require('./projectservice').ProjectTypes;
var GeometryTypes = require('./projectservice').GeometryTypes;
var ol3helpers = require('g3w-ol3/src/g3w.ol3').helpers;
var PickCoordinatesInteraction = require('g3w/core/interactions/pickcoordinatesinteraction');
var WMSLayer = require('./wmslayer');

var PickToleranceParams = {};
PickToleranceParams[ProjectTypes.QDJANGO] = {};
PickToleranceParams[ProjectTypes.QDJANGO][GeometryTypes.POINT] = "FI_POINT_TOLERANCE";
PickToleranceParams[ProjectTypes.QDJANGO][GeometryTypes.LINESTRING] = "FI_LINE_TOLERANCE";
PickToleranceParams[ProjectTypes.QDJANGO][GeometryTypes.POLYGON] = "FI_POLYGON_TOLERANCE";

var PickToleranceValues = {}
PickToleranceValues[GeometryTypes.POINT] = 5;
PickToleranceValues[GeometryTypes.LINESTRING] = 5;
PickToleranceValues[GeometryTypes.POLYGON] = 5;

function MapService(){
  var self = this;
  this.viewer;
  this.mapLayers = {};
  this.layersAssociation = {};
  this.state = {
      bbox: [],
      resoution: null,
      center: null,
      loading: false
  };
  
  this._howManyAreLoading = 0;
  
  this._interactionsStack = [];
  
  this.setters = {
    setMapView: function(bbox,resoution,center){
      this.state.bbox = bbox;
      this.state.resolution = resoution;
      this.state.resolutin = center
    },
    setIsLoading: function(bool){
      var delta = bool ? 1 : -1;
      var isFirstIncrement = (this._howManyAreLoading == 0) && (delta == 1);
      var isLastDecrement = (this._howManyAreLoading == 1) && (delta == -1);
      this._howManyAreLoading += delta;

      if (isFirstIncrement || isLastDecrement){
        this.state.loading = bool;
        if (bool) {
          this.emit('loadstart');
        }
        else {
          this.emit('loadend');
        }
      }
    }
  };
  
  ProjectService.on('projectset',function(){
    $script("http://epsg.io/"+ProjectService.state.project.crs+".js");
    if (!self.viewer){
      self.setupViewer();
    }
    self.setupLayers();
    self.emit('viewerset');
  });
  
  ProjectService.onafter('setLayersVisible',function(layers){
    _.forEach(layers,function(layer){
      var mapLayer = self.getMapLayerForLayer(layer);
      mapLayer.update();
    })
  });
  
  this.setupViewer = function(){
    var extent = ProjectService.state.project.extent;
    var projection = new ol.proj.Projection({
      code: "EPSG:"+ProjectService.state.project.crs,
      extent: extent
    });
    this.viewer = ol3helpers.createViewer({
      view: {
        projection: projection,
        center: ol.extent.getCenter(ProjectService.state.project.extent),
        zoom: 0
        //zoom:7 
      }
    });
    
    var view = this.viewer.map.getView();
    /*view.on('change:resolution',function(e){
      self.setViewBBOX(self.viewer.getBBOX());
      self.setResolution(self.viewer.getResolution());
    });*/
    
    this.viewer.map.on('moveend',function(e){
      self._setMapView();
    })
  };
  
  this.getViewerElement = function(){
    this.viewer.map.getTargetElement();
  };
  
  this.getViewport = function(){
    return this.viewer.map.getViewport();
  };
  
  this.setupLayers = function(){
    this.viewer.map.getLayers().clear();
    this.mapLayers = {};
    this.layersAssociation = {};
    var layersArray = this.traverseLayersTree(ProjectService.state.project.layerstree);
    layersArray.forEach(function(layer){
      // è un layer vero, non un folder
      if(!_.get(layer,'nodes')){
        var layerId = 'layer_'+layer.metalayer;
        var mapLayer = _.get(self.mapLayers,layerId);
        if (!mapLayer){
          url = ProjectService.getWmsUrl();
          mapLayer = self.mapLayers[layerId] = new WMSLayer({
            id: layerId,
            url: url
          });
          self.registerListeners(mapLayer);
        }
        mapLayer.addLayer(layer);
        self.layersAssociation[layer.id] = layerId;
      }
    });
    
    _.forEach(this.mapLayers,function(mapLayer){
      self.viewer.map.addLayer(mapLayer.getLayer());
      mapLayer.update();
    })
  };
  
  this.getMapLayerForLayer = function(layer){
    return this.mapLayers['layer_'+layer.metalayer];
  };
  
  this.traverseLayersTree = function(layersTree){
    var self = this;
    var layersArray = [];
    function traverse(obj){
      _.forIn(obj, function (val, key) {
          if (!_.isNil(val.id)) {
              layersArray.unshift(val);
          }
          if (!_.isNil(val.nodes)) {
              traverse(val.nodes);
          }
      });
    }
    traverse(layersTree);
    return layersArray;
  };
  
  this.registerListeners = function(mapLayer){
    mapLayer.on('loadstart',function(){
      self.setIsLoading(true);
    });
    mapLayer.on('loadend',function(){
      self.setIsLoading(false);
    });
  };
  
  this.showViewer = function(elId){
    this.viewer.setTarget(elId);
    var map = this.viewer.map;
    GUI.on('guiready',function(){
      self._setMapView();
    });
  };
  
  
  // per creare una pila di ol.interaction in cui l'ultimo che si aggiunge disattiva temporaemente i precedenti (per poi togliersi di mezzo con popInteraction!)
  // Usato ad es. da pickfeaturetool e getfeatureinfo
  this.pushInteraction = function(interaction){
    if (this._interactionsStack.length){
      var prevInteraction = this._interactionsStack.slice(-1)[0];
      if (_.isArray(prevInteraction)){
        _.forEach(prevInteraction,function(interaction){
          interaction.setActive(false);
        })
      }
      else{
        prevInteraction.setActive(false);
      };
    }
    
    this.viewer.map.addInteraction(interaction);
    interaction.setActive(true);
    this._interactionsStack.push(interaction)
  };
  
  this.popInteraction = function(){
    var interaction = this._interactionsStack.pop();
    this.viewer.map.removeInteraction(interaction);
    
    if (this._interactionsStack.length){
      var prevInteraction = this._interactionsStack.slice(-1)[0];
      if (_.isArray(prevInteraction)){
        _.forEach(prevInteraction,function(interaction){
          interaction.setActive(true);
        })
      }
      else{
        prevInteraction.setActive(true);
      };
    }
  };
  
  this.goTo = function(coordinates,zoom){
    var zoom = zoom || 6;
    this.viewer.goTo(coordinates,zoom);
  };
  
  this.goToWGS84 = function(coordinates,zoom){
    var coordinates = ol.proj.transform(coordinates,'EPSG:4326','EPSG:'+ProjectService.state.project.crs);
    this.goTo(coordinates,zoom);
  };
  
  this.extentToWGS84 = function(extent){
    return ol.proj.transformExtent(extent,'EPSG:'+ProjectService.state.project.crs,'EPSG:4326');
  };
  
  this.getFeatureInfo = function(layerId){
    var self = this;
    var deferred = $.Deferred();
    this._pickInteraction = new PickCoordinatesInteraction();
    //this.viewer.map.addInteraction(this._pickInteraction);
    //this._pickInteraction.setActive(true);
    this.pushInteraction(this._pickInteraction);
    this._pickInteraction.on('picked',function(e){
      self._completeGetFeatureInfo(layerId,e.coordinate,deferred);
    })
    return deferred.promise();
  };
  
  this._completeGetFeatureInfo = function(layerId,coordinate,deferred){
    var self = this;
    var projectType = ProjectService.state.project.type;
    
    var mapLayer = this.mapLayers[this.layersAssociation[layerId]];
    var resolution = self.viewer.getResolution();
    var epsg = "EPSG:"+ProjectService.state.project.crs;
    var params = {
      QUERY_LAYERS: ProjectService.getLayer(layerId).name,
      INFO_FORMAT: "text/xml"
    }
    
    if (projectType == ProjectTypes.QDJANGO){
      var toleranceParams = PickToleranceParams[projectType];
      if (toleranceParams){
        var geometrytype = ProjectService.getLayer(layerId).geometrytype;
        params[toleranceParams[geometrytype]] = PickToleranceValues[geometrytype];
      }
    }
    
    var getFeatureInfoUrl = mapLayer.getSource().getGetFeatureInfoUrl(coordinate,resolution,epsg,params);
    $.get(getFeatureInfoUrl)
    .then(function(data){
      var x2js = new X2JS();
      var jsonData = x2js.xml2json(data);
      if (jsonData.GetFeatureInfoResponse.Layer.Feature){
        var attributes = jsonData.GetFeatureInfoResponse.Layer.Feature.Attribute;
        var attributesObj = {};
        _.forEach(attributes,function(attribute){
          attributesObj[attribute._name] = attribute._value; // X2JS aggiunge "_" come prefisso degli attributi
        })
        
        deferred.resolve(attributesObj);
      }
      deferred.reject();;
    })
    .fail(function(){
      deferred.reject();
    })
    .always(function(){
      //self.viewer.map.removeInteraction(self._pickInteraction);
      self.popInteraction();
      self._pickInteraction = null;
    })
  };
  
  this.highlightGeometry = function(geometryObj,duration,fromWGS84){
    var geometry;
    if (geometryObj instanceof ol.geom.Geometry){
      geometry = geometryObj;
    }
    else {
      format = new ol.format.GeoJSON;
      geometry = format.readGeometry(geometryObj);
    }
    
    if (fromWGS84) {
      geometry.transform('EPSG:4326','EPSG:'+ProjectService.state.project.crs);
    }
    
    var feature = new ol.Feature({
      geometry: geometry
    });
    var source = new ol.source.Vector();
    source.addFeatures([feature]);
    var layer = new ol.layer.Vector({
      source: source,
      style: function(feature){
        var styles = [];
        var geometryType = feature.getGeometry().getType();
        if (geometryType == ol.geom.GeometryType.LINE_STRING) {
          var style = new ol.style.Style({
            stroke: new ol.style.Stroke({
              color: 'rgb(255,255,0)',
              width: 4
            })
          })
          styles.push(style);
        }
        else if (geometryType == ol.geom.GeometryType.POINT){
          var style = new ol.style.Style({
            image: new ol.style.Circle({
              radius: 6,
              fill: new ol.style.Fill({
                color: 'rgb(255,255,0)',
              })
            }),
            zIndex: Infinity
          });
          styles.push(style);
        }
        
        return styles;
      }
    })
    layer.setMap(this.viewer.map);
    
    setTimeout(function(){
      layer.setMap(null);
    },duration);
  };
  
  this.refreshMap = function(){
    _.forEach(this.mapLayers,function(wmsLayer){
      wmsLayer.getLayer().getSource().updateParams({"time": Date.now()});
    })
  };
  
  base(this);
  
  this._setMapView = function(){
    var bbox = this.viewer.getBBOX();
    var resolution = this.viewer.getResolution();
    var center = this.viewer.getCenter();
    this.setMapView(bbox,resolution,center);
  };
};

inherit(MapService,G3WObject);

module.exports = new MapService
