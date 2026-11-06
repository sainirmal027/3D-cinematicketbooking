FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /build
COPY . .
RUN mvn -B -DskipTests package dependency:copy-dependencies \
    -DincludeScope=runtime \
    -DoutputDirectory=target/dependency

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /build/target/seatix-website-1.0.0.jar app.jar
COPY --from=build /build/target/dependency ./dependency
ENV SEATIX_HOST=0.0.0.0
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "exec java -cp 'app.jar:dependency/*' com.seatix.SeatixServer \"${PORT:-8080}\""]
