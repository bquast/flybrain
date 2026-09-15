/* Compatibility entry point for the shared, configurable rate model. */
(function(root){
  'use strict';
  if(typeof module!=='undefined'&&module.exports){
    module.exports=require('../../js/rate-model.js');
  }else{
    if(!root.FlyBrainRateModel)importScripts('../../js/rate-model.js');
    root.DroneBrain=root.FlyBrainRateModel;
  }
})(typeof globalThis!=='undefined'?globalThis:this);
