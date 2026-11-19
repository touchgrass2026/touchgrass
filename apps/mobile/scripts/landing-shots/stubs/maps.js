const React = require('react');
const { View } = require('react-native');

function MapView(props) {
  return React.createElement(View, { style: [props.style, { backgroundColor: '#1B2B1F' }] });
}
function Nothing() {
  return null;
}
module.exports = { __esModule: true, default: MapView, Marker: Nothing, Circle: Nothing };
