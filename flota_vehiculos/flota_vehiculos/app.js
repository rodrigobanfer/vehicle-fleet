var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var session = require('express-session');

var indexRouter = require('./routes/index');

var app = express();

//Configuración motor plantillas
app.use(session({
  secret: 'flota_vehiculos_secreto',  
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 // 24 horas
  }    
}));

//Configuración de ejs como motor de plantillas
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');


app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);

//catch de error 404 y pasarlo al handler
app.use(function(req, res, next) {
  next(createError(404));
});

//error handler
app.use(function(err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;