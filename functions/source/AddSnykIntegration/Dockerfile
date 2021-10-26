FROM lambci/lambda:build-nodejs12.x

COPY . .

RUN npm install
RUN rm Dockerfile && \
    find . -exec touch -t 202007010000.00 {} + && \
	zip -X -r lambda.zip ./

CMD mkdir -p /output/ && mv lambda.zip /output/